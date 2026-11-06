// HTTP layer for gift redemption and the admin fulfilment API.
// Winners are not app users. Authorisation for admin is a checked callback,
// never a password shipped to the browser.

import {
  byteaHex,
  clientIp,
  hmacSha256,
  isUuid,
  normalizeCode,
  publicConfig,
  toHex,
  validateDetails,
  windowId,
  type ClaimPayload,
  type ServiceConfig,
} from "./gift_logic.ts";

export type TryClaimResult =
  | { result: "ok"; confirmation_ref: string; claim_id?: string; status?: string }
  | { result: "rejected" }
  | { result: "closed" }
  | { result: "invalid_details"; fields: Record<string, string> };

export interface GiftStore {
  serviceConfig(): Promise<ServiceConfig>;
  rateHit(bucket: string, limit: number): Promise<number>;
  tryClaim(codeHash: Uint8Array, claim: ClaimPayload): Promise<TryClaimResult>;
}

export interface AdminStore {
  list(): Promise<unknown[]>;
  markShipped(id: string, carrier: string | null, tracking: string | null): Promise<Record<string, unknown>>;
  redactDue(): Promise<number>;
  setCampaign(patch: Record<string, unknown>): Promise<ServiceConfig>;
  serviceConfig(): Promise<ServiceConfig>;
}

export type RedeemDeps = {
  pepper: string;
  allowedOrigins: string[];
  store: GiftStore;
  now?: () => Date;
  clientIp?: (req: Request) => string;
};

export type AdminAuth =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export type AdminDeps = {
  allowedOrigins: string[];
  store: AdminStore;
  requireAdmin: (req: Request) => Promise<AdminAuth>;
};

function securityHeaders(origin: string | null, allowed: string[], methods: string): Headers {
  const headers = new Headers();
  if (origin && allowed.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-methods", methods);
    headers.set("access-control-allow-headers", "content-type, apikey, authorization, x-client-info");
    headers.set("access-control-max-age", "600");
  }
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  return headers;
}

function json(status: number, body: unknown, headers: Headers): Response {
  const copy = new Headers(headers);
  copy.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: copy });
}

function originOf(req: Request, allowed: string[]): string | null {
  const origin = req.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return null;
  return origin;
}

async function readJson(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > 8000) return { ok: false, status: 413, error: "invalid_request" };
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) return { ok: false, status: 415, error: "invalid_request" };
  const raw = await req.text();
  if (raw.length > 8000) return { ok: false, status: 413, error: "invalid_request" };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "invalid_request" };
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: "invalid_request" };
  }
}

async function rateBucket(pepper: string, kind: string, secret: string, seconds: number, now: Date): Promise<string> {
  const mac = await hmacSha256(pepper, `${kind}:${secret}`);
  return `${kind}:${toHex(mac)}:${windowId(now, seconds)}`;
}

export async function handleGiftRedeem(req: Request, deps: RedeemDeps): Promise<Response> {
  const url = new URL(req.url);
  const headers = securityHeaders(req.headers.get("origin"), deps.allowedOrigins, "GET, POST, OPTIONS");
  if (url.search) return json(400, { ok: false, error: "invalid_request" }, headers);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: originOf(req, deps.allowedOrigins) ? 204 : 403, headers });
  }
  if (!deps.pepper || deps.pepper.length < 16) return json(503, { ok: false, error: "unavailable" }, headers);

  let cfg: ServiceConfig;
  try {
    cfg = await deps.store.serviceConfig();
  } catch {
    return json(503, { ok: false, error: "unavailable" }, headers);
  }

  if (req.method === "GET") {
    const origin = req.headers.get("origin");
    if (origin && !deps.allowedOrigins.includes(origin)) return json(403, { ok: false, error: "origin" }, headers);
    return json(200, publicConfig(cfg), headers);
  }
  if (req.method !== "POST") return json(405, { ok: false, error: "method" }, headers);
  if (!originOf(req, deps.allowedOrigins)) return json(403, { ok: false, error: "origin" }, headers);

  const parsed = await readJson(req);
  if (!parsed.ok) return json(parsed.status, { ok: false, error: parsed.error }, headers);
  if (parsed.body.action === "campaign") return json(200, publicConfig(cfg), headers);

  const now = deps.now ? deps.now() : new Date();
  const ip = (deps.clientIp ? deps.clientIp(req) : clientIp(req)) || "unknown";
  try {
    const ipHits = await deps.store.rateHit(await rateBucket(deps.pepper, "ip", ip, cfg.ip_window_seconds, now), cfg.ip_limit);
    if (ipHits > cfg.ip_limit) return json(429, { ok: false, error: "rate_limited" }, headers);
    const dayHits = await deps.store.rateHit(await rateBucket(deps.pepper, "ipday", ip, 86400, now), cfg.ip_day_limit);
    if (dayHits > cfg.ip_day_limit) return json(429, { ok: false, error: "rate_limited" }, headers);
  } catch {
    return json(503, { ok: false, error: "unavailable" }, headers);
  }

  if (!cfg.active) return json(403, { ok: false, error: "closed" }, headers);
  if (cfg.redeem_deadline && Date.parse(cfg.redeem_deadline) <= now.getTime()) {
    return json(400, { ok: false, error: "invalid_code" }, headers);
  }

  const code = normalizeCode(parsed.body.code);
  if (!code) return json(400, { ok: false, error: "invalid_code" }, headers);

  const details = validateDetails(parsed.body, cfg.allowed_countries);
  if (!details.ok) return json(400, { ok: false, error: "invalid_details", fields: details.fields }, headers);

  let result: TryClaimResult;
  try {
    const codeHash = await hmacSha256(deps.pepper, code);
    const codeHits = await deps.store.rateHit(
      await rateBucket(deps.pepper, "code", toHex(codeHash), cfg.code_window_seconds, now),
      cfg.code_limit,
    );
    if (codeHits > cfg.code_limit) return json(429, { ok: false, error: "rate_limited" }, headers);
    result = await deps.store.tryClaim(codeHash, details.claim);
  } catch {
    return json(503, { ok: false, error: "unavailable" }, headers);
  }

  if (result.result === "ok" && /^TF-[0-9A-F]{8}$/.test(result.confirmation_ref)) {
    return json(200, {
      ok: true,
      confirmation_ref: result.confirmation_ref,
      status: "pending_shipment",
    }, headers);
  }
  if (result.result === "closed") return json(403, { ok: false, error: "closed" }, headers);
  if (result.result === "invalid_details") {
    return json(400, { ok: false, error: "invalid_details", fields: result.fields }, headers);
  }
  return json(400, { ok: false, error: "invalid_code" }, headers);
}

function cleanShort(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  if (!text || text.length > max || CTRL.test(text)) return null;
  return text;
}

const CTRL = /[\u0000-\u001F\u007F]/;

export async function handleGiftAdmin(req: Request, deps: AdminDeps): Promise<Response> {
  const url = new URL(req.url);
  const headers = securityHeaders(req.headers.get("origin"), deps.allowedOrigins, "POST, OPTIONS");
  if (url.search) return json(400, { ok: false, error: "invalid_request" }, headers);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: originOf(req, deps.allowedOrigins) ? 204 : 403, headers });
  }
  if (!originOf(req, deps.allowedOrigins)) return json(403, { ok: false, error: "origin" }, headers);
  if (req.method !== "POST") return json(405, { ok: false, error: "method" }, headers);

  const auth = await deps.requireAdmin(req);
  if (!auth.ok) return json(auth.status, { ok: false, error: auth.error }, headers);

  const parsed = await readJson(req);
  if (!parsed.ok) return json(parsed.status, { ok: false, error: parsed.error }, headers);

  try {
    if (parsed.body.action === "list") {
      const claims = await deps.store.list();
      return json(200, { ok: true, claims }, headers);
    }
    if (parsed.body.action === "mark_shipped") {
      if (!isUuid(parsed.body.claim_id)) return json(400, { ok: false, error: "invalid_request" }, headers);
      const carrier = parsed.body.carrier == null || parsed.body.carrier === "" ? null : cleanShort(parsed.body.carrier, 80);
      const tracking = parsed.body.tracking == null || parsed.body.tracking === "" ? null : cleanShort(parsed.body.tracking, 80);
      if (parsed.body.carrier && !carrier) return json(400, { ok: false, error: "invalid_request" }, headers);
      if (parsed.body.tracking && !tracking) return json(400, { ok: false, error: "invalid_request" }, headers);
      const result = await deps.store.markShipped(parsed.body.claim_id, carrier, tracking);
      return json(result.ok ? 200 : 400, result, headers);
    }
    if (parsed.body.action === "redact_due") {
      const redacted = await deps.store.redactDue();
      return json(200, { ok: true, redacted }, headers);
    }
    if (parsed.body.action === "config") {
      const cfg = await deps.store.serviceConfig();
      return json(200, { ok: true, campaign: cfg }, headers);
    }
    if (parsed.body.action === "set_campaign") {
      const patch = parsed.body.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return json(400, { ok: false, error: "invalid_campaign" }, headers);
      }
      const cfg = await deps.store.setCampaign(patch as Record<string, unknown>);
      return json(200, { ok: true, campaign: cfg }, headers);
    }
  } catch {
    return json(400, { ok: false, error: "invalid_request" }, headers);
  }
  return json(400, { ok: false, error: "invalid_request" }, headers);
}

export { byteaHex };
