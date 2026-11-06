// Shared by the inactive gift-submit function. The website copy is js/gift-code.js.
// Keep canonicalizeGiftCode and prepareGiftSubmission in step with that file.

export var COUNTRIES = ["GB", "CN", "HK", "MO", "IE"];

export function canonicalizeGiftCode(input) {
  if (typeof input !== "string") return null;
  var text = input.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  text = text.replace(/[\s\-‐‑–—−]/g, "");
  text = text.toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0");
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(text)) return null;
  return text;
}

function cleanText(value, max, required) {
  if (typeof value !== "string") return null;
  var text = value.normalize("NFKC").trim();
  if (/[\u0000-\u001F\u007F]/.test(text)) return null;
  if (text.length > max) return null;
  if (required && text.length < 1) return null;
  return text;
}

export function prepareGiftSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "fields" };
  }
  var name = cleanText(input.recipient_name, 100, true);
  var phone = cleanText(input.phone, 24, true);
  var email = cleanText(input.email == null ? "" : input.email, 254, false);
  var address1 = cleanText(input.address1, 120, true);
  var address2 = cleanText(input.address2 == null ? "" : input.address2, 120, false);
  var city = cleanText(input.city, 80, true);
  var postcode = cleanText(input.postcode, 16, true);
  var country = typeof input.country === "string" ? input.country.normalize("NFKC").trim().toUpperCase() : "";
  var digits = phone ? phone.replace(/\D/g, "") : "";
  var emailOk = email !== null && (email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  var fieldsOk = !!(name && phone && emailOk && address1 && address2 !== null && city && postcode
    && COUNTRIES.indexOf(country) !== -1
    && digits.length >= 7 && digits.length <= 20
    && input.consent === true);
  if (!fieldsOk) return { ok: false, reason: "fields" };
  var code = canonicalizeGiftCode(input.code);
  if (!code) return { ok: false, reason: "code_format" };
  return {
    ok: true,
    submission: {
      code: code,
      recipient_name: name,
      phone: phone,
      email: email,
      address1: address1,
      address2: address2,
      city: city,
      postcode: postcode,
      country: country,
      consent: true
    }
  };
}

export async function hmacSha256Hex(pepper, message) {
  var key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  var raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  var bytes = new Uint8Array(raw);
  var hex = "";
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
