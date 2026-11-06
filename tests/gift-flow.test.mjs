import assert from "node:assert/strict";
import fs from "node:fs";
import test, { before, after } from "node:test";
import pg from "pg";
import { hmacSha256 } from "../supabase/functions/_shared/gift_logic.ts";
import { handleGiftAdmin, handleGiftRedeem } from "../supabase/functions/_shared/gift_http.ts";
import { createPgGiftStore } from "../scripts/pg_gift_store.mjs";

const PEPPER = "TEST-ONLY-PEPPER";
const ADMIN_URL = "postgres://gift_test:gift_test@127.0.0.1:5432/postgres";
const DB_URL = "postgres://gift_test:gift_test@127.0.0.1:5432/gift_unit";
const ORIGIN = "http://127.0.0.1";
const CODES = {
  closed: "TEST-ONLY-CODE-NOT-LIVE-01",
  badAddress: "TEST-ONLY-CODE-NOT-LIVE-02",
  minimal: "TEST-ONLY-CODE-NOT-LIVE-03",
  repeat: "TEST-ONLY-CODE-NOT-LIVE-04",
  intl: "TEST-ONLY-CODE-NOT-LIVE-05",
  inject: "TEST-ONLY-CODE-NOT-LIVE-06",
  country: "TEST-ONLY-CODE-NOT-LIVE-07",
  deadline: "TEST-ONLY-CODE-NOT-LIVE-08",
  rate: "TEST-ONLY-CODE-NOT-LIVE-09",
  race: "TEST-ONLY-CODE-NOT-LIVE-10",
  rollback: "TEST-ONLY-CODE-NOT-LIVE-11",
  spaces: "TEST-ONLY-CODE-NOT-LIVE-12",
  query: "TEST-ONLY-CODE-NOT-LIVE-13",
  origin: "TEST-ONLY-CODE-NOT-LIVE-14",
  ship: "TEST-ONLY-CODE-NOT-LIVE-15",
};

let pool;
let store;
let ipCounter = 10;

function nextIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function delivery(code, extra = {}) {
  return {
    code,
    recipient_name: "Ann Example",
    address_line1: "1 Test Lane",
    city: "Testville",
    postcode: "TE1 1ST",
    country: "GB",
    phone: "07700900000",
    consent: true,
    ...extra,
  };
}

async function post(body, ip = nextIp()) {
  const response = await handleGiftRedeem(new Request("http://127.0.0.1/functions/v1/gift-redeem", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  }), {
    pepper: PEPPER,
    allowedOrigins: [ORIGIN, "https://teafairyworld.co.uk"],
    store,
  });
  const json = await response.json();
  return { status: response.status, body: json };
}

async function codeStatus(code) {
  const hash = Buffer.from(await hmacSha256(PEPPER, code));
  const { rows } = await pool.query("select status from gift_codes where code_hash = $1", [hash]);
  return rows[0]?.status ?? null;
}

let tail = Promise.resolve();
function serial(name, fn) {
  test(name, () => {
    const run = tail.then(fn, fn);
    tail = run.then(() => {}, () => {});
    return run;
  });
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query("drop database if exists gift_unit with (force)");
  await admin.query("create database gift_unit owner gift_test");
  await admin.end();

  const setup = new pg.Client({ connectionString: DB_URL });
  await setup.connect();
  await setup.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$`);
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261106120000_gift_redemption.sql", import.meta.url), "utf8");
  await setup.query(sql);
  await setup.end();

  pool = new pg.Pool({ connectionString: DB_URL, max: 30 });
  store = createPgGiftStore(pool);
  const hashes = [];
  for (const code of Object.values(CODES)) hashes.push(await hmacSha256(PEPPER, code));
  const provisioned = await store.provision(hashes);
  assert.equal(provisioned.total, Object.keys(CODES).length);
  await store.setCampaign({ active: true, ip_limit: 20, code_limit: 20, ip_day_limit: 50 });
});

after(async () => {
  if (pool) await pool.end();
});

serial("a closed campaign does not burn a code", async () => {
  await store.setCampaign({ active: false });
  const result = await post(delivery(CODES.closed));
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "closed");
  assert.equal(await codeStatus(CODES.closed), "available");
  await store.setCampaign({ active: true });
});

serial("an unknown code is a generic rejection and creates no claim", async () => {
  const before = await pool.query("select count(*)::int as n from gift_claims");
  const result = await post(delivery("TEST-ONLY-CODE-NOT-LIVE-99"));
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid_code");
  assert.equal(JSON.stringify(result.body).includes("Test Lane"), false);
  const after = await pool.query("select count(*)::int as n from gift_claims");
  assert.equal(after.rows[0].n, before.rows[0].n);
});

serial("a failed address does not burn the code and a corrected one does", async () => {
  const bad = await post(delivery(CODES.badAddress, { city: "" }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_details");
  assert.equal(await codeStatus(CODES.badAddress), "available");
  const good = await post(delivery(CODES.badAddress));
  assert.equal(good.status, 200);
  assert.match(good.body.confirmation_ref, /^TF-[0-9A-F]{8}$/);
  assert.equal(good.body.status, "pending_shipment");
  assert.equal(await codeStatus(CODES.badAddress), "claimed");
});

serial("minimal and repeated claims keep a single record", async () => {
  const first = await post(delivery(CODES.minimal, { address_line2: "", instructions: "" }));
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.body).sort(), ["confirmation_ref", "ok", "status"]);
  const second = await post(delivery(CODES.minimal));
  assert.equal(second.status, 400);
  assert.equal(second.body.error, "invalid_code");
  assert.equal(second.body.confirmation_ref, undefined);
  const { rows } = await pool.query(
    "select count(*)::int as n from gift_claims c join gift_codes g on g.id = c.code_id where g.code_hash = $1",
    [Buffer.from(await hmacSha256(PEPPER, CODES.minimal))],
  );
  assert.equal(rows[0].n, 1);
});

serial("whitespace and case still match the same code once", async () => {
  const ok = await post(delivery("  test-only-code-not-live-12  "));
  assert.equal(ok.status, 200);
  const again = await post(delivery(CODES.spaces));
  assert.equal(again.body.error, "invalid_code");
});

serial("an international address is stored for dispatch", async () => {
  const result = await post(delivery(CODES.intl, {
    recipient_name: "张伟",
    address_line1: "静安区南京西路100号",
    city: "上海市",
    postcode: "200000",
    country: "CN",
    phone: "+86 21 0000 0000",
    email: "winner@example.com",
    instructions: "请工作日送达",
  }));
  assert.equal(result.status, 200);
  const claims = await store.list();
  const claim = claims.find((row) => row.confirmation_ref === result.body.confirmation_ref);
  assert.equal(claim.recipient_name, "张伟");
  assert.equal(claim.city, "上海市");
  assert.equal(claim.country, "CN");
  assert.equal(claim.status, "pending_shipment");
});

serial("SQL injection is stored as text and the claims table remains", async () => {
  const name = "Robert'); DROP TABLE gift_claims;--";
  const result = await post(delivery(CODES.inject, { recipient_name: name, instructions: "<script>alert(1)</script>" }));
  assert.equal(result.status, 200);
  const { rows } = await pool.query("select recipient_name, instructions from gift_claims where confirmation_ref = $1", [
    result.body.confirmation_ref,
  ]);
  assert.equal(rows[0].recipient_name, name);
  await pool.query("select count(*) from gift_claims");
});

serial("an unknown country and a disallowed country do not burn the code", async () => {
  const unknown = await post(delivery(CODES.country, { country: "ZZ" }));
  assert.equal(unknown.body.error, "invalid_details");
  assert.equal(await codeStatus(CODES.country), "available");
  await store.setCampaign({ allowed_countries: ["GB"] });
  const blocked = await post(delivery(CODES.country, { country: "CN" }));
  assert.equal(blocked.body.fields.country, "unavailable");
  assert.equal(await codeStatus(CODES.country), "available");
  const ok = await post(delivery(CODES.country));
  assert.equal(ok.status, 200);
  await store.setCampaign({ allowed_countries: null });
});

serial("a passed deadline does not burn the code", async () => {
  await store.setCampaign({ redeem_deadline: "2020-01-01T00:00:00Z" });
  const expired = await post(delivery(CODES.deadline));
  assert.equal(expired.body.error, "invalid_code");
  assert.equal(await codeStatus(CODES.deadline), "available");
  await store.setCampaign({ redeem_deadline: null });
  const ok = await post(delivery(CODES.deadline));
  assert.equal(ok.status, 200);
});

serial("IP and code limits fail closed without a successful extra claim", async () => {
  await store.setCampaign({ ip_limit: 2, ip_window_seconds: 900, code_limit: 2, ip_day_limit: 50 });
  const ip = "198.51.100.20";
  const first = await post(delivery("TEST-ONLY-CODE-NOT-LIVE-90"), ip);
  const second = await post(delivery("TEST-ONLY-CODE-NOT-LIVE-91"), ip);
  const third = await post(delivery(CODES.rate), ip);
  assert.equal(first.body.error, "invalid_code");
  assert.equal(second.body.error, "invalid_code");
  assert.equal(third.status, 429);
  assert.equal(third.body.error, "rate_limited");
  assert.equal(await codeStatus(CODES.rate), "available");
  const later = await post(delivery(CODES.rate), "198.51.100.21");
  assert.equal(later.status, 200);
  const replayIp = "198.51.100.22";
  await post(delivery(CODES.rate), replayIp);
  await post(delivery(CODES.rate), replayIp);
  const limited = await post(delivery(CODES.rate), "198.51.100.23");
  assert.equal(limited.status, 429);
  await store.setCampaign({ ip_limit: 20, code_limit: 20, ip_day_limit: 50 });
});

serial("simultaneous claims redeem a code once", async () => {
  await store.setCampaign({ ip_limit: 100, code_limit: 30, ip_day_limit: 200 });
  const ip = "198.51.100.40";
  const results = await Promise.all(Array.from({ length: 25 }, () => post(delivery(CODES.race), ip)));
  const wins = results.filter((result) => result.status === 200 && result.body.ok);
  assert.equal(wins.length, 1);
  const { rows } = await pool.query(
    "select count(*)::int as n from gift_claims c join gift_codes g on g.id = c.code_id where g.code_hash = $1",
    [Buffer.from(await hmacSha256(PEPPER, CODES.race))],
  );
  assert.equal(rows[0].n, 1);
  assert.equal(await codeStatus(CODES.race), "claimed");
});

serial("a database failure while saving the address rolls the code back", async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      create or replace function gift_test_fail() returns trigger
      language plpgsql as $fn$ begin raise exception 'forced failure'; end $fn$`);
    await client.query("create trigger gift_test_fail before insert on gift_claims for each row execute function gift_test_fail()");
    await assert.rejects(async () => store.tryClaim(await hmacSha256(PEPPER, CODES.rollback), {
      recipient_name: "Ann Example",
      address_line1: "1 Test Lane",
      address_line2: null,
      city: "Testville",
      postcode: "TE1 1ST",
      country: "GB",
      phone: "07700900000",
      email: null,
      instructions: null,
      consent: true,
    }));
    assert.equal(await codeStatus(CODES.rollback), "available");
  } finally {
    await client.query("drop trigger if exists gift_test_fail on gift_claims");
    await client.query("drop function if exists gift_test_fail()");
    client.release();
  }
  const recovered = await post(delivery(CODES.rollback));
  assert.equal(recovered.status, 200);
});

serial("anonymous and non-admin callers cannot read claims", async () => {
  const client = await pool.connect();
  try {
    await client.query("set role anon");
    await assert.rejects(() => client.query("select * from gift_claims"), /permission denied/);
    await assert.rejects(() => client.query("select gift_admin_list()"), /permission denied/);
    await client.query("reset role");
    await client.query("grant select on gift_claims to anon");
    await client.query("set role anon");
    const hidden = await client.query("select * from gift_claims");
    assert.equal(hidden.rows.length, 0);
    await client.query("reset role");
    await client.query("revoke select on gift_claims from anon");
    await client.query("set role service_role");
    const cfg = await client.query("select gift_service_config() as config");
    assert.equal(typeof cfg.rows[0].config.active, "boolean");
    await assert.rejects(() => client.query("select * from gift_claims"), /permission denied/);
    await client.query("reset role");
  } finally {
    await client.query("reset role");
    client.release();
  }

  let listed = 0;
  const guarded = { ...store, list: async () => { listed += 1; return store.list(); } };
  const denied = await handleGiftAdmin(new Request("http://127.0.0.1/functions/v1/gift-admin", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  }), {
    allowedOrigins: [ORIGIN],
    store: guarded,
    requireAdmin: async () => ({ ok: false, status: 401, error: "unauthorised" }),
  });
  assert.equal(denied.status, 401);
  assert.equal(listed, 0);
  const body = await denied.json();
  assert.equal(JSON.stringify(body).includes("Test Lane"), false);

  const forbidden = await handleGiftAdmin(new Request("http://127.0.0.1/functions/v1/gift-admin", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  }), {
    allowedOrigins: [ORIGIN],
    store: guarded,
    requireAdmin: async () => ({ ok: false, status: 403, error: "forbidden" }),
  });
  assert.equal(forbidden.status, 403);
  assert.equal(listed, 0);
});

serial("an authorised owner can mark a claim shipped and later remove the address", async () => {
  const created = await post(delivery(CODES.ship, { phone: "07700900123", email: "winner@example.com" }));
  const claims = await store.list();
  const claim = claims.find((row) => row.confirmation_ref === created.body.confirmation_ref);
  const admin = {
    allowedOrigins: [ORIGIN],
    store,
    requireAdmin: async () => ({ ok: true, userId: "00000000-0000-0000-0000-000000000001" }),
  };
  const shipped = await handleGiftAdmin(new Request("http://127.0.0.1/functions/v1/gift-admin", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "mark_shipped", claim_id: claim.id, carrier: "Royal Mail", tracking: "TEST-TRACK" }),
  }), admin);
  const shippedBody = await shipped.json();
  assert.equal(shipped.status, 200);
  assert.equal(shippedBody.status, "shipped");
  const again = await handleGiftAdmin(new Request("http://127.0.0.1/functions/v1/gift-admin", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "mark_shipped", claim_id: claim.id, carrier: "Royal Mail", tracking: "TEST-TRACK" }),
  }), admin);
  const againBody = await again.json();
  assert.equal(againBody.status, "shipped");
  assert.equal(new Date(againBody.shipped_at).toISOString(), new Date(shippedBody.shipped_at).toISOString());

  await pool.query("update gift_claims set shipped_at = now() - interval '10 days' where id = $1", [claim.id]);
  await store.setCampaign({ retention_days: 1 });
  const removed = await handleGiftAdmin(new Request("http://127.0.0.1/functions/v1/gift-admin", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "redact_due" }),
  }), admin);
  const removedBody = await removed.json();
  assert.equal(removedBody.redacted >= 1, true);
  const after = (await store.list()).find((row) => row.id === claim.id);
  assert.equal(after.recipient_name, "");
  assert.equal(after.address_line1, "");
  assert.equal(after.phone, null);
  assert.equal(after.email, null);
  assert.equal(after.status, "shipped");
  assert.ok(after.redacted_at);
});

serial("codes are not accepted in the query string or from another origin", async () => {
  const queried = await handleGiftRedeem(new Request("http://127.0.0.1/functions/v1/gift-redeem?code=SECRET", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(delivery(CODES.query)),
  }), { pepper: PEPPER, allowedOrigins: [ORIGIN], store });
  assert.equal(queried.status, 400);
  assert.equal(await codeStatus(CODES.query), "available");

  const foreign = await handleGiftRedeem(new Request("http://127.0.0.1/functions/v1/gift-redeem", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify(delivery(CODES.origin)),
  }), { pepper: PEPPER, allowedOrigins: [ORIGIN], store });
  assert.equal(foreign.status, 403);
  assert.equal(await codeStatus(CODES.origin), "available");

  const campaign = await handleGiftRedeem(new Request("http://127.0.0.1/functions/v1/gift-redeem", {
    method: "GET",
    headers: { origin: ORIGIN },
  }), { pepper: PEPPER, allowedOrigins: [ORIGIN], store });
  const info = await campaign.json();
  assert.equal(info.ok, true);
  assert.equal(Object.hasOwn(info, "claims"), false);
  assert.equal(JSON.stringify(info).includes("Test Lane"), false);
});
