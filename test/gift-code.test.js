const test = require("node:test");
const assert = require("node:assert/strict");
const codes = require("../js/gift-code.js");

const CANON = "0123456789ABCDEFGHJKMNPQRS";

test("canonical length and alphabet", () => {
  assert.equal(CANON.length, 26);
  assert.equal(codes.canonicalizeGiftCode(CANON), CANON);
});

test("accepts hyphens, case, and surrounding spaces", () => {
  assert.equal(codes.canonicalizeGiftCode("  0123-4567-89ab-cdef-ghjk-mnpqrs  "), CANON);
  assert.equal(codes.canonicalizeGiftCode("0123 4567 89AB CDEF GHJK MNPQRS"), CANON);
});

test("accepts full-width letters, digits, spaces, and hyphens", () => {
  const full = "０１２３４５６７８９ＡＢＣＤＥＦＧＨＪＫＭＮＰＱＲＳ";
  assert.equal(codes.canonicalizeGiftCode(full), CANON);
  assert.equal(codes.canonicalizeGiftCode("０１２３－４５６７－８９ＡＢ－ＣＤＥＦ－ＧＨＪＫ－ＭＮＰＱＲＳ"), CANON);
  assert.equal(codes.canonicalizeGiftCode("\u3000" + CANON + "\u3000"), CANON);
});

test("maps Crockford confusables and drops zero-width characters", () => {
  const mixed = "OL" + CANON.slice(2);
  assert.equal(codes.canonicalizeGiftCode("\u200B" + mixed + "\uFEFF"), CANON);
});

test("rejects ids, short strings, and letters outside the alphabet", () => {
  assert.equal(codes.canonicalizeGiftCode("G01"), null);
  assert.equal(codes.canonicalizeGiftCode("GP01"), null);
  assert.equal(codes.canonicalizeGiftCode("T01"), null);
  assert.equal(codes.canonicalizeGiftCode("TP01"), null);
  assert.equal(codes.canonicalizeGiftCode(CANON.slice(0, 25)), null);
  assert.equal(codes.canonicalizeGiftCode(CANON + "0"), null);
  assert.equal(codes.canonicalizeGiftCode(CANON.replace("S", "U")), null);
  assert.equal(codes.canonicalizeGiftCode(""), null);
  assert.equal(codes.canonicalizeGiftCode(null), null);
});

test("prepareGiftSubmission returns the endpoint schema and the canonical code", () => {
  const prepared = codes.prepareGiftSubmission({
    code: " 0123-4567-89ab-cdef-ghjk-mnpqrs ",
    recipient_name: " Example Person ",
    phone: "+44 7000 000000",
    email: "",
    address1: "1 Example Street",
    address2: "",
    city: "Exampleton",
    postcode: "AA1 1AA",
    country: "gb",
    consent: true,
    tier: "grand",
    id: "G01"
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(Object.keys(prepared.submission), [
    "code", "recipient_name", "phone", "email", "address1", "address2", "city", "postcode", "country", "consent"
  ]);
  assert.equal(prepared.submission.code, CANON);
  assert.equal(prepared.submission.country, "GB");
  assert.equal(prepared.submission.email, "");
  assert.equal(prepared.submission.consent, true);
  assert.equal("tier" in prepared.submission, false);
  assert.equal("id" in prepared.submission, false);
});

test("field problems are not reported as an unusable code", () => {
  const missing = codes.prepareGiftSubmission({ code: CANON, consent: true });
  assert.deepEqual(missing, { ok: false, reason: "fields" });
  const badCode = codes.prepareGiftSubmission({
    code: "G01",
    recipient_name: "Example Person",
    phone: "07000000000",
    email: "person@example.com",
    address1: "1 Example Street",
    address2: "",
    city: "Exampleton",
    postcode: "AA1 1AA",
    country: "GB",
    consent: true
  });
  assert.deepEqual(badCode, { ok: false, reason: "code_format" });
});

test("browser and edge copies of the normaliser match", async () => {
  const edge = await import("../supabase/functions/_shared/gift-code.mjs");
  const samples = [CANON, "  0123-4567-89ab-cdef-ghjk-mnpqrs  ", "G01", "", null, "０１２３－４５６７－８９ＡＢ－ＣＤＥＦ－ＧＨＪＫ－ＭＮＰＱＲＳ"];
  for (const sample of samples) {
    assert.equal(codes.canonicalizeGiftCode(sample), edge.canonicalizeGiftCode(sample));
  }
  const body = {
    code: CANON,
    recipient_name: "Example Person",
    phone: "07000000000",
    email: "person@example.com",
    address1: "1 Example Street",
    address2: "Flat 2",
    city: "Exampleton",
    postcode: "AA1 1AA",
    country: "HK",
    consent: true
  };
  assert.deepEqual(codes.prepareGiftSubmission(body), edge.prepareGiftSubmission(body));
});

test("edge HMAC matches node crypto and does not use the code as the hash", async () => {
  const { createHmac } = require("node:crypto");
  const edge = await import("../supabase/functions/_shared/gift-code.mjs");
  const pepper = "TEST-ONLY-PEPPER-DO-NOT-USE-000000000000";
  const hex = await edge.hmacSha256Hex(pepper, CANON);
  const expected = createHmac("sha256", pepper).update(CANON, "utf8").digest("hex");
  assert.equal(hex, expected);
  assert.equal(hex.length, 64);
  assert.equal(hex.includes(CANON), false);
});
