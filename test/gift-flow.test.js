const test = require("node:test");
const assert = require("node:assert/strict");
const flow = require("../js/gift-flow.js");
const config = require("../js/gift-config.js");

const CODE = "0123-4567-89ab-cdef-ghjk-mnpqrs";
const CANON = "0123456789ABCDEFGHJKMNPQRS";
const CONFIRM = "11111111-1111-4111-8111-111111111111";

function fields(overrides) {
  return Object.assign({
    code: CODE,
    recipient_name: "Example Person",
    phone: "07000000000",
    email: "person@example.com",
    address1: "1 Example Street",
    address2: "",
    city: "Exampleton",
    postcode: "AA1 1AA",
    country: "GB",
    consent: true
  }, overrides);
}

function enabled() {
  return { submissionsEnabled: true, endpoint: flow.ENDPOINT };
}

test("shipped config is the UK gift endpoint and is disabled", () => {
  assert.equal(config.submissionsEnabled, false);
  assert.equal(config.endpoint, "https://tkxepmevhhzfmorbhriz.supabase.co/functions/v1/gift-submit");
  assert.equal(flow.ENDPOINT, config.endpoint);
  assert.equal(flow.submissionsEnabled(config), false);
});

test("disabled form does not fetch or report success", async () => {
  let called = false;
  const result = await flow.submitGift(fields(), {
    config,
    anonKey: "anon-test",
    fetchImpl() {
      called = true;
      return Promise.resolve({ status: 200, json: async () => ({ confirmation_id: CONFIRM, tier: "standard" }) });
    }
  });
  assert.equal(called, false);
  assert.deepEqual(result, { view: "disabled", sent: false });
});

test("enabled form posts the canonical code and schema, not an id or hash", async () => {
  const calls = [];
  const result = await flow.submitGift(fields({ code: "\u3000" + CODE + "\u3000" }), {
    config: enabled(),
    anonKey: "anon-test",
    fetchImpl(url, options) {
      calls.push({ url, options });
      return { status: 200, json: async () => ({ confirmation_id: CONFIRM, tier: "standard", voucher_id: "G01" }) };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, flow.ENDPOINT);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.code, CANON);
  assert.equal(body.consent, true);
  assert.equal("voucher_id" in body, false);
  assert.equal("code_hash" in body, false);
  assert.equal(calls[0].options.headers.apikey, "anon-test");
  assert.equal(result.view, "success");
  assert.equal(result.tier, "standard");
  assert.equal(result.confirmationId, CONFIRM);
  assert.equal("voucher_id" in result, false);
});

test("local code problems do not use the redeemed message and do not fetch", async () => {
  let called = false;
  const result = await flow.submitGift(fields({ code: "G01" }), {
    config: enabled(),
    anonKey: "anon-test",
    fetchImpl() { called = true; }
  });
  assert.equal(called, false);
  assert.equal(result.view, "invalid_request");
});

test("invalid or used is shown only from that endpoint error", () => {
  assert.equal(flow.interpretResult({ status: 400, json: { error: "invalid_or_used" } }).view, "invalid_or_used");
  assert.equal(flow.interpretResult({ status: 503, json: { error: "unavailable" } }).view, "unavailable");
  assert.equal(flow.interpretResult({ status: 500, json: { error: "invalid_or_used" } }).view, "unavailable");
  assert.equal(flow.interpretResult({ networkError: true }).view, "unavailable");
  assert.equal(flow.interpretResult({ status: 200, json: { ok: true } }).view, "unavailable");
  assert.equal(flow.interpretResult({ status: 200, json: { confirmation_id: CONFIRM, tier: "GP01" } }).view, "unavailable");
  const grand = flow.interpretResult({ status: 200, json: { confirmation_id: CONFIRM, tier: "grand" } });
  assert.equal(grand.view, "success");
  assert.equal(grand.tier, "grand");
});

function mockDoc() {
  const elements = {};
  function make(id) {
    const node = {
      id,
      hidden: false,
      disabled: false,
      value: "",
      checked: false,
      textContent: "",
      focused: false,
      focus() { node.focused = true; }
    };
    elements[id] = node;
    return node;
  }
  ["gift-inactive", "gift-unavailable", "gift-invalid", "gift-fields", "gift-success", "standard-note", "grand-note", "confirmation-id", "form-wrap", "gift-fields-set", "submit", "redeem-form"].forEach(make);
  elements["redeem-form"].reset = function () { elements["redeem-form"].resetCalled = true; };
  elements["gift-success"].textContent = "Thank you";
  return {
    elements,
    getElementById(id) { return elements[id] || null; }
  };
}

test("display states keep the redeemed message apart from an outage and a grand receipt", () => {
  const doc = mockDoc();
  flow.applyView(doc, { view: "disabled" });
  assert.equal(doc.elements["gift-inactive"].hidden, false);
  assert.equal(doc.elements["gift-success"].hidden, true);
  assert.equal(doc.elements["gift-fields-set"].disabled, true);
  assert.match(doc.elements["submit"].textContent, /尚未开放/);

  flow.applyView(doc, { view: "unavailable" });
  assert.equal(doc.elements["gift-unavailable"].hidden, false);
  assert.equal(doc.elements["gift-invalid"].hidden, true);
  assert.equal(doc.elements["gift-fields-set"].disabled, false);

  flow.applyView(doc, { view: "invalid_or_used" });
  assert.equal(doc.elements["gift-invalid"].hidden, false);
  assert.equal(doc.elements["gift-unavailable"].hidden, true);
  assert.equal(doc.elements["confirmation-id"].textContent, "");

  flow.applyView(doc, { view: "success", confirmationId: CONFIRM, tier: "grand" });
  assert.equal(doc.elements["gift-success"].hidden, false);
  assert.equal(doc.elements["grand-note"].hidden, false);
  assert.equal(doc.elements["standard-note"].hidden, true);
  assert.equal(doc.elements["confirmation-id"].textContent, CONFIRM);
  assert.equal(doc.elements["form-wrap"].hidden, true);
  assert.equal(doc.elements["redeem-form"].resetCalled, true);
  assert.equal(doc.elements["gift-success"].focused, true);
});

test("attach on the disabled page ignores a forced submit", async () => {
  const doc = mockDoc();
  let calls = 0;
  doc.elements["redeem-form"].addEventListener = function (type, fn) {
    doc.elements["redeem-form"].listeners = doc.elements["redeem-form"].listeners || {};
    doc.elements["redeem-form"].listeners[type] = fn;
  };
  doc.elements["redeem-form"].reportValidity = () => true;
  ["code", "recipient_name", "phone", "email", "address1", "address2", "city", "postcode", "country", "consent"].forEach((id) => {
    doc.elements[id] = { value: id === "consent" ? "" : "x", checked: true };
  });
  doc.elements.code.value = CODE;
  flow.attach(doc, {
    config,
    anonKey: "anon-test",
    fetchImpl() { calls += 1; }
  });
  doc.elements["redeem-form"].listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(doc.elements["gift-inactive"].hidden, false);
  assert.equal(doc.elements["gift-success"].hidden, true);
  assert.equal(doc.elements["confirmation-id"].textContent, "");
});
