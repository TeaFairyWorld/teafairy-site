import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hmacSha256 } from "../supabase/functions/_shared/gift_logic.ts";
import { handleGiftAdmin, handleGiftRedeem } from "../supabase/functions/_shared/gift_http.ts";
import { createPgGiftStore } from "./pg_gift_store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const pepper = process.env.GIFT_CODE_PEPPER || "TEST-ONLY-PEPPER";
const databaseUrl = process.env.DATABASE_URL || "postgres://gift_test:gift_test@127.0.0.1:5432/gift_dev";
const adminToken = randomBytes(24).toString("hex");
const fixtures = [
  "TEST-ONLY-CODE-NOT-LIVE-01",
  "TEST-ONLY-CODE-NOT-LIVE-02",
  "TEST-ONLY-CODE-NOT-LIVE-03",
  "TEST-ONLY-CODE-NOT-LIVE-04",
];

if (!pepper.includes("TEST-ONLY")) {
  console.error("This local server only runs with a TEST-ONLY pepper.");
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

async function prepare() {
  const admin = new pg.Client({ connectionString: databaseUrl.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("unsupported database name");
  const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
  if (!exists.rowCount) await admin.query(`create database ${name} owner gift_test`);
  await admin.end();
  const setup = new pg.Client({ connectionString: databaseUrl });
  await setup.connect();
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261106120000_gift_redemption.sql"), "utf8");
  await setup.query(sql);
  await setup.end();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
  const store = createPgGiftStore(pool);
  const hashes = [];
  for (const code of fixtures) hashes.push(await hmacSha256(pepper, code));
  await store.provision(hashes);
  await store.setCampaign({ active: true, allowed_countries: null, redeem_deadline: null, retention_days: 90, ip_limit: 10, code_limit: 5, ip_day_limit: 30 });
  return { pool, store };
}

function devAdminHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local gift fulfilment</title>
<link rel="stylesheet" href="/style.css"></head><body>
<header><nav><a class="brand" href="/index.html">TeaFairy 茶仙子</a><a href="/redeem.html">Gift</a></nav></header>
<main><h1>Local fulfilment check</h1><p>This page exists only on the local test server. It uses the same gift panel as the signed-in admin, with a temporary token that is not a production password.</p><div id="app"></div></main>
<script src="/admin/gift-panel.js"></script>
<script>
const token = ${JSON.stringify(adminToken)};
TeaFairyGifts.mount(document.getElementById("app"), { async call(body) {
  const response = await fetch("/functions/v1/gift-admin", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok || json.ok === false) throw new Error(json.error || "request failed");
  return json;
}});
</script></body></html>`;
}

const { store } = await prepare();
const deps = { pepper, allowedOrigins: [origin, "http://localhost:" + port], store };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (req.headers.host && !/^127\.0\.0\.1(:\d+)?$/.test(req.headers.host) && !/^localhost(:\d+)?$/.test(req.headers.host)) {
    res.writeHead(403).end("local only");
    return;
  }
  if (url.pathname === "/functions/v1/gift-redeem" || url.pathname === "/functions/v1/gift-admin") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(origin + url.pathname + url.search, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const response = url.pathname.endsWith("gift-admin")
      ? await handleGiftAdmin(request, {
        ...deps,
        requireAdmin: async (incoming) => {
          const header = incoming.headers.get("authorization") || "";
          return header === `Bearer ${adminToken}`
            ? { ok: true, userId: "dev-admin" }
            : { ok: false, status: 401, error: "unauthorised" };
        },
      })
      : await handleGiftRedeem(request, deps);
    const headers = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (url.pathname === "/dev/gift-admin") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
    res.end(devAdminHtml());
    return;
  }
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.join(root, path.normalize(relative));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local gift server http://127.0.0.1:${port}/redeem.html`);
});
