// INACTIVE proposed handler. It returns unavailable unless GIFT_SUBMIT_ACTIVE
// is exactly "true". It does not log the request, the code, the address, or secrets.

import { hmacSha256Hex, prepareGiftSubmission } from "../_shared/gift-code.mjs";

var PROJECT_URL = "https://tkxepmevhhzfmorbhriz.supabase.co";
var ALLOWED = new Set([
  "https://teafairyworld.co.uk",
  "https://www.teafairyworld.co.uk",
]);

function headers(origin) {
  var h = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (origin && ALLOWED.has(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("vary", "Origin");
    h.set("access-control-allow-headers", "content-type, apikey, authorization, accept");
    h.set("access-control-allow-methods", "POST, OPTIONS");
  }
  return h;
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), { status: status, headers: headers(origin) });
}

function unavailable(origin) {
  return reply(503, { error: "unavailable" }, origin);
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  var length = Math.max(left.length, right.length);
  var diff = left.length === right.length ? 0 : 1;
  for (var i = 0; i < length; i++) {
    var a = i < left.length ? left.charCodeAt(i) : 0;
    var b = i < right.length ? right.charCodeAt(i) : 0;
    diff |= a ^ b;
  }
  return diff === 0;
}

export async function handleGiftSubmit(req, env, fetchImpl) {
  var origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: origin && ALLOWED.has(origin) ? 204 : 403, headers: headers(origin) });
  }
  if (req.method !== "POST") return unavailable(origin);
  if (!env || env.get("GIFT_SUBMIT_ACTIVE") !== "true") return unavailable(origin);

  var projectUrl = (env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  var anon = env.get("SUPABASE_ANON_KEY") || "";
  var serviceKey = env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  var pepper = env.get("VOUCHER_PEPPER") || "";
  if (projectUrl !== PROJECT_URL || pepper.length < 32 || pepper !== pepper.trim() || /\s/.test(pepper) || !anon || !serviceKey || safeEqual(serviceKey, anon)) {
    return unavailable(origin);
  }
  if (!safeEqual(req.headers.get("apikey") || "", anon)) return reply(401, { error: "unavailable" }, origin);

  var raw;
  try {
    raw = await req.text();
  } catch {
    return reply(400, { error: "invalid_request" }, origin);
  }
  if (raw.length > 4000) return reply(400, { error: "invalid_request" }, origin);
  var body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid_request" }, origin);
  }
  var prepared = prepareGiftSubmission(body);
  if (!prepared.ok) {
    if (prepared.reason === "code_format") return reply(400, { error: "invalid_or_used" }, origin);
    return reply(400, { error: "invalid_request" }, origin);
  }

  var submission = prepared.submission;
  var codeHash = await hmacSha256Hex(pepper, submission.code);
  var rpcPayload = {
    p: {
      code_hash: codeHash,
      recipient_name: submission.recipient_name,
      phone: submission.phone,
      email: submission.email,
      address1: submission.address1,
      address2: submission.address2,
      city: submission.city,
      postcode: submission.postcode,
      country: submission.country,
      consent: true,
    },
  };

  var saved;
  try {
    saved = await fetchImpl(PROJECT_URL + "/rest/v1/rpc/gift_redeem", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        apikey: serviceKey,
        authorization: "Bearer " + serviceKey,
      },
      body: JSON.stringify(rpcPayload),
    });
  } catch {
    return unavailable(origin);
  }
  if (!saved || !saved.ok) return unavailable(origin);

  var data = null;
  try {
    data = await saved.json();
  } catch {
    return unavailable(origin);
  }
  if (!data || typeof data !== "object") return unavailable(origin);
  if (data.result === "invalid_or_used") return reply(400, { error: "invalid_or_used" }, origin);
  if (data.result === "invalid_request") return reply(400, { error: "invalid_request" }, origin);
  if (data.result !== "ok") return unavailable(origin);
  var id = data.confirmation_id;
  var tier = data.tier;
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof id !== "string" || !uuid.test(id) || (tier !== "standard" && tier !== "grand")) {
    return unavailable(origin);
  }
  return reply(200, { confirmation_id: id, tier: tier }, origin);
}
