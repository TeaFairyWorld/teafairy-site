import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { normalizeCode, validateDetails } from "../supabase/functions/_shared/gift_logic.ts";
import { reviewCodes } from "../scripts/provision-gift-codes.mjs";
import { fileURLToPath } from "node:url";
import { assertOutsideRepo, generateGiftCode } from "../scripts/generate-gift-codes.mjs";

test("normalises gift codes without keeping spaces or case", () => {
  assert.equal(normalizeCode("  test-only-code-not-live-01 "), "TEST-ONLY-CODE-NOT-LIVE-01");
  assert.equal(normalizeCode("abc"), null);
  assert.equal(normalizeCode("bad code!!"), null);
  assert.equal(normalizeCode(12), null);
});

test("rejects a delivery form that is missing consent or a city", () => {
  const missing = validateDetails({
    recipient_name: "Ann Example",
    address_line1: "1 Test Lane",
    city: "",
    postcode: "TE1 1ST",
    country: "GB",
    consent: true,
  }, null);
  assert.equal(missing.ok, false);
  assert.equal(missing.fields.city, "invalid");

  const consent = validateDetails({
    recipient_name: "Ann Example",
    address_line1: "1 Test Lane",
    city: "Testville",
    postcode: "TE1 1ST",
    country: "GB",
    consent: false,
  }, null);
  assert.equal(consent.fields.consent, "required");
});

test("accepts a minimal British address and an international address", () => {
  const missingPhone = validateDetails({
    recipient_name: "Ann Example",
    address_line1: "1 Test Lane",
    city: "Testville",
    postcode: "TE1 1ST",
    country: "gb",
    phone: "",
    consent: true,
  }, null);
  assert.equal(missingPhone.ok, false);
  assert.equal(missingPhone.fields.phone, "invalid");

  const minimal = validateDetails({
    recipient_name: "Ann Example",
    address_line1: "1 Test Lane",
    city: "Testville",
    postcode: "TE1 1ST",
    country: "gb",
    phone: "07700900000",
    consent: true,
  }, null);
  assert.equal(minimal.ok, true);
  assert.equal(minimal.claim.country, "GB");
  assert.equal(minimal.claim.phone, "07700900000");
  assert.equal(minimal.claim.email, null);

  const intl = validateDetails({
    recipient_name: "张伟",
    address_line1: "静安区南京西路100号",
    city: "上海市",
    postcode: "200000",
    country: "CN",
    phone: "+86 21 0000 0000",
    email: "winner@example.com",
    instructions: "请工作日送达",
    consent: true,
  }, ["CN", "GB"]);
  assert.equal(intl.ok, true);
});

test("refuses a country outside the configured list without treating it as a code error", () => {
  const result = validateDetails({
    recipient_name: "Ann Example",
    address_line1: "1 Test Lane",
    city: "Testville",
    postcode: "TE1 1ST",
    country: "CN",
    consent: true,
  }, ["GB"]);
  assert.equal(result.fields.country, "unavailable");
});

test("admin rendering escapes delivery notes", () => {
  const source = fs.readFileSync(new URL("../admin/gift-panel.js", import.meta.url), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const html = sandbox.window.TeaFairyGifts.renderClaims([{
    id: "11111111-1111-1111-1111-111111111111",
    confirmation_ref: "TF-AABBCCDD",
    status: "pending_shipment",
    recipient_name: "Robert'); DROP TABLE gift_claims;--",
    address_line1: "1 Test Lane",
    city: "Testville",
    postcode: "TE1 1ST",
    country: "GB",
    instructions: "<script>alert(1)</script><img src=x onerror=alert(1)>",
    created_at: "2026-11-06T12:00:00Z",
  }]);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Robert&#39;\); DROP TABLE gift_claims;--/);
});

test("the public page does not store delivery details or ship a fixture code", () => {
  const js = fs.readFileSync(new URL("../redeem.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../redeem.html", import.meta.url), "utf8");
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(js + html, /TEST-ONLY/);
  assert.match(js, /replaceState/);
  assert.match(js, /credentials:\s*"omit"/);
  assert.match(html, /no-referrer/);
  assert.match(html, /method="post"/);
});

test("country list matches the migration and referral links cannot carry a generated code", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261106120000_gift_redemption.sql", import.meta.url), "utf8");
  const json = JSON.parse(fs.readFileSync(new URL("../iso-countries.json", import.meta.url), "utf8"));
  const sqlCodes = new Set(sql.match(/regexp_split_to_table\(\s*'([^']+)'/)[1].split(/\s+/));
  const jsonCodes = new Set(json.map((row) => row.code));
  assert.deepEqual([...jsonCodes].sort(), [...sqlCodes].sort());
  assert.ok(sqlCodes.has("GB"));
  assert.equal(sqlCodes.has("UK"), false);

  const referral = /^\/r\/([A-Za-z0-9-]{3,20})\/?$/;
  const code = generateGiftCode();
  assert.equal(code.length, 23);
  assert.equal(referral.test("/r/" + code), false);
  assert.equal(referral.test("/r/TEST-ONLY-CODE-NOT-LIVE-01"), false);
});

test("provisioning rejects the wrong count, short codes and fixtures without echoing them", () => {
  const sentinel = "SHORTCODE";
  const twenty = Array.from({ length: 20 }, () => generateGiftCode());
  assert.equal(reviewCodes(twenty.join("\n")).ok, true);
  const fixture = reviewCodes([sentinel, ...twenty.slice(0, 19)].join(","));
  assert.equal(fixture.ok, false);
  assert.equal(fixture.error.includes(sentinel), false);
  const named = reviewCodes("TEST-ONLY-CODE-NOT-LIVE-01");
  assert.equal(named.ok, false);
  assert.equal(named.error.includes("TEST-ONLY-CODE-NOT-LIVE-01"), false);
  assert.throws(() => assertOutsideRepo(fileURLToPath(new URL("../gift-codes.txt", import.meta.url))), /repository/);
});

test("tracked examples do not contain a real code list", () => {
  const example = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /^REDEEM_CODES=$/m);
  assert.doesNotMatch(example, /REDEEM_CODES=.+/);
  const migration = fs.readFileSync(new URL("../supabase/migrations/20261106120000_gift_redemption.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /TEST-ONLY/);
  assert.match(migration, /revoke all on gift_campaign, gift_codes, gift_claims/);
});
