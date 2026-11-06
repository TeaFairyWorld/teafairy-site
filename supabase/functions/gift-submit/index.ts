// Public insert only. Does not return the address. Reads stay in the Supabase dashboard.
const ALLOWED = new Set([
  "https://teafairyworld.co.uk",
  "https://www.teafairyworld.co.uk",
]);
const COUNTRIES = new Set(["GB", "CN", "HK", "MO", "IE"]);

function headers(origin: string | null): Headers {
  const h = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (origin && ALLOWED.has(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("vary", "Origin");
    h.set("access-control-allow-headers", "content-type, apikey, authorization");
    h.set("access-control-allow-methods", "POST, OPTIONS");
  }
  return h;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  if (!text || text.length > max || /[\u0000-\u001F\u007F]/.test(text)) return null;
  return text;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = headers(origin);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: origin && ALLOWED.has(origin) ? 204 : 403, headers: h });
  }
  if (req.method !== "POST" || !origin || !ALLOWED.has(origin)) {
    return new Response(JSON.stringify({ ok: false }), { status: 403, headers: h });
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return new Response(JSON.stringify({ ok: false }), { status: 503, headers: h });

  const raw = await req.text();
  if (raw.length > 4000) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: h });
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad");
    body = parsed;
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: h });
  }

  const reference = clean(body.reference_code, 64);
  const name = clean(body.recipient_name, 100);
  const phone = clean(body.phone, 24);
  const line1 = clean(body.address_line1, 120);
  const line2raw = body.address_line2 == null || body.address_line2 === "" ? "" : clean(body.address_line2, 120);
  const city = clean(body.city, 80);
  const postcode = clean(body.postcode, 16);
  const country = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
  const digits = phone ? phone.replace(/\D/g, "") : "";
  if (!reference || !name || !phone || !line1 || line2raw === null || !city || !postcode || !COUNTRIES.has(country) || digits.length < 7 || digits.length > 20) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: h });
  }

  const saved = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/gift_save_submission`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      p: {
        reference_code: reference,
        recipient_name: name,
        phone,
        address_line1: line1,
        address_line2: line2raw,
        city,
        postcode,
        country,
      },
    }),
  });
  if (!saved.ok) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: h });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
});
