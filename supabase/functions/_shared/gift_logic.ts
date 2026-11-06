// Gift-code helpers shared by the Edge Functions and the local tests.
// No plaintext codes are stored. Lookup is HMAC-SHA256 equality in Postgres.

export const CODE_PATTERN = /^[A-Z0-9-]{8,64}$/;
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\uFEFF]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldName =
  | "recipient_name"
  | "address_line1"
  | "address_line2"
  | "city"
  | "postcode"
  | "country"
  | "phone"
  | "email"
  | "instructions"
  | "consent";

export type FieldCode = "invalid" | "required" | "unavailable";
export type FieldErrors = Partial<Record<FieldName, FieldCode>>;

export type ClaimPayload = {
  recipient_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postcode: string;
  country: string;
  phone: string | null;
  email: string | null;
  instructions: string | null;
  consent: true;
};

export type ServiceConfig = {
  active: boolean;
  redeem_deadline: string | null;
  allowed_countries: string[] | null;
  retention_days: number;
  ip_limit: number;
  ip_window_seconds: number;
  code_limit: number;
  code_window_seconds: number;
  ip_day_limit: number;
};

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.normalize("NFKC").trim().replace(/\s+/g, "").toUpperCase();
  if (!CODE_PATTERN.test(compact)) return null;
  return compact;
}

export async function hmacSha256(pepper: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function byteaHex(bytes: Uint8Array): string {
  return "\\x" + toHex(bytes);
}

function badText(value: unknown): boolean {
  return typeof value === "string" && (CTRL.test(value) || BIDI.test(value));
}

function optionalLine(value: unknown, max: number): string | null | "bad" {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || badText(value)) return "bad";
  const text = value.normalize("NFKC").trim();
  if (!text) return null;
  if (text.length > max || CTRL.test(text) || BIDI.test(text)) return "bad";
  return text;
}

function requiredLine(value: unknown, max: number): string | "bad" {
  const text = optionalLine(value, max);
  if (text == null || text === "bad") return "bad";
  return text;
}

export function validateDetails(
  body: Record<string, unknown>,
  allowedCountries: string[] | null,
): { ok: true; claim: ClaimPayload } | { ok: false; fields: FieldErrors } {
  const fields: FieldErrors = {};
  const name = requiredLine(body.recipient_name, 100);
  if (name === "bad" || !/\p{L}/u.test(name)) fields.recipient_name = "invalid";

  const line1 = requiredLine(body.address_line1, 120);
  if (line1 === "bad") fields.address_line1 = "invalid";

  const line2 = optionalLine(body.address_line2, 120);
  if (line2 === "bad") fields.address_line2 = "invalid";

  const city = requiredLine(body.city, 80);
  if (city === "bad") fields.city = "invalid";

  const postcode = requiredLine(body.postcode, 16);
  if (postcode === "bad" || !/^[\p{L}\p{N}][\p{L}\p{N} \-]{0,15}$/u.test(postcode)) {
    fields.postcode = "invalid";
  }

  const countryRaw = typeof body.country === "string" ? body.country.normalize("NFKC").trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(countryRaw)) fields.country = "invalid";
  else if (allowedCountries && allowedCountries.length && !allowedCountries.includes(countryRaw)) {
    fields.country = "unavailable";
  }

  const phoneText = requiredLine(body.phone, 24);
  let phone: string | null = null;
  if (phoneText === "bad") fields.phone = "invalid";
  else {
    const digits = phoneText.replace(/\D/g, "");
    if (!/^[0-9+(). \-]{7,24}$/.test(phoneText) || digits.length < 7 || digits.length > 20) {
      fields.phone = "invalid";
    } else phone = phoneText;
  }

  let email: string | null = null;
  if (body.email != null && body.email !== "") {
    if (typeof body.email !== "string" || badText(body.email)) fields.email = "invalid";
    else {
      email = body.email.normalize("NFKC").trim();
      if (email.length > 254 || email.includes("..") || !EMAIL.test(email) || CTRL.test(email) || BIDI.test(email)) {
        fields.email = "invalid";
      }
    }
  }

  let instructions: string | null = null;
  if (body.instructions != null && body.instructions !== "") {
    if (typeof body.instructions !== "string") fields.instructions = "invalid";
    else {
      instructions = body.instructions.normalize("NFKC").replace(/\r\n/g, "\n").trim();
      if (!instructions) instructions = null;
      else if (instructions.length > 400 || BIDI.test(instructions) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(instructions)) {
        fields.instructions = "invalid";
      }
    }
  }

  if (body.consent !== true) fields.consent = "required";

  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    claim: {
      recipient_name: name as string,
      address_line1: line1 as string,
      address_line2: line2 as string | null,
      city: city as string,
      postcode: postcode as string,
      country: countryRaw,
      phone,
      email,
      instructions,
      consent: true,
    },
  };
}

export function windowId(now: Date, seconds: number): number {
  const span = Math.max(1, Math.floor(seconds));
  return Math.floor(now.getTime() / 1000 / span);
}

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim().slice(0, 80);
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 80);
  }
  return "unknown";
}

export function publicConfig(cfg: ServiceConfig) {
  return {
    ok: true as const,
    active: !!cfg.active,
    redeem_deadline: cfg.redeem_deadline,
    allowed_countries: cfg.allowed_countries,
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
