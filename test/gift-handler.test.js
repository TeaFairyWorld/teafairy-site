const test = require("node:test");
const assert = require("node:assert/strict");

let handleGiftSubmit;
test.before(async () => {
  ({ handleGiftSubmit } = await import("../supabase/functions/gift-submit/handler.mjs"));
});

const PEPPER = "TEST-ONLY-PEPPER-DO-NOT-USE-000000000000";
const CANON = "0123456789ABCDEFGHJKMNPQRS";
const CONFIRM = "22222222-2222-4222-8222-222222222222";
const PROJECT = "https://tkxepmevhhzfmorbhriz.supabase.co";

function env(extra) {
  return {
    get(name) {
      const values = Object.assign({
        GIFT_SUBMIT_ACTIVE: "true",
        VOUCHER_PEPPER: PEPPER,
        SUPABASE_URL: PROJECT,
        SUPABASE_ANON_KEY: "anon-test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-only"
      }, extra);
      return values[name] || "";
    }
  };
}

function body(overrides) {
  return Object.assign({
    code: "0123-4567-89ab-cdef-ghjk-mnpqrs",
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

function post(payload, headers) {
  return new Request(PROJECT + "/functions/v1/gift-submit", {
    method: "POST",
    headers: Object.assign({
      origin: "https://teafairyworld.co.uk",
      apikey: "anon-test",
      "content-type": "application/json"
    }, headers),
    body: JSON.stringify(payload)
  });
}

function watchConsole(fn) {
  const originals = {};
  const calls = [];
  for (const name of ["log", "info", "warn", "error", "debug"]) {
    originals[name] = console[name];
    console[name] = (...args) => calls.push(args);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const name of Object.keys(originals)) console[name] = originals[name];
    })
    .then((result) => {
      assert.equal(calls.length, 0);
      return result;
    });
}

test("inactive function does not store or echo a code", async () => {
  await watchConsole(async () => {
    let called = false;
    const res = await handleGiftSubmit(
      post(body({ code: "SHOULD-NOT-ECHO" })),
      env({ GIFT_SUBMIT_ACTIVE: "false" }),
      () => { called = true; }
    );
    assert.equal(called, false);
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.equal(text, JSON.stringify({ error: "unavailable" }));
    assert.equal(text.includes("SHOULD-NOT-ECHO"), false);
  });
});

test("redeem posts only the hash to the UK project and returns the receipt", async () => {
  await watchConsole(async () => {
    const calls = [];
    const res = await handleGiftSubmit(post(body()), env(), async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: "ok", confirmation_id: CONFIRM, tier: "grand", voucher_id: "GP01" })
      };
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, PROJECT + "/rest/v1/rpc/gift_redeem");
    assert.equal(calls[0].options.headers.authorization, "Bearer service-role-test-only");
    const rpc = JSON.parse(calls[0].options.body);
    assert.equal(Object.hasOwn(rpc.p, "code"), false);
    assert.equal(JSON.stringify(rpc).includes(CANON), false);
    assert.match(rpc.p.code_hash, /^[0-9a-f]{64}$/);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { confirmation_id: CONFIRM, tier: "grand" });
    assert.equal(res.headers.get("access-control-allow-origin"), "https://teafairyworld.co.uk");
  });
});

test("the same canonical code always produces the same hash", async () => {
  const hashes = [];
  const fetchImpl = async (_url, options) => {
    hashes.push(JSON.parse(options.body).p.code_hash);
    return { ok: true, status: 200, json: async () => ({ result: "invalid_or_used" }) };
  };
  await handleGiftSubmit(post(body({ code: "0123-4567-89ab-cdef-ghjk-mnpqrs" })), env(), fetchImpl);
  await handleGiftSubmit(post(body({ code: "０１２３－４５６７－８９ＡＢ－ＣＤＥＦ－ＧＨＪＫ－ＭＮＰＱＲＳ" })), env(), fetchImpl);
  assert.equal(hashes[0], hashes[1]);
});

test("used and unknown codes share one response, and an outage is different", async () => {
  const used = await handleGiftSubmit(post(body()), env(), async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: "invalid_or_used" })
  }));
  assert.equal(used.status, 400);
  assert.deepEqual(await used.json(), { error: "invalid_or_used" });

  const down = await handleGiftSubmit(post(body()), env(), async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: "SENTINEL_DB_MESSAGE" })
  }));
  assert.equal(down.status, 503);
  const text = await down.text();
  assert.equal(text.includes("SENTINEL_DB_MESSAGE"), false);
  assert.equal(text.includes("invalid_or_used"), false);
});

test("a bad address does not look like a redeemed code and does not call the database", async () => {
  let called = false;
  const res = await handleGiftSubmit(post(body({ city: "" })), env(), () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_request" });
});

test("a missing pepper or the wrong project stays unavailable", async () => {
  for (const extra of [{ VOUCHER_PEPPER: "" }, { SUPABASE_URL: "https://example.supabase.co" }, { GIFT_SUBMIT_ACTIVE: "false" }]) {
    let called = false;
    const res = await handleGiftSubmit(post(body()), env(extra), () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.status, 503);
  }
});

test("the service role key is not accepted from the browser in place of the anon key", async () => {
  let called = false;
  const res = await handleGiftSubmit(
    post(body(), { apikey: "service-role-test-only" }),
    env(),
    () => { called = true; }
  );
  assert.equal(called, false);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "unavailable" });
});
