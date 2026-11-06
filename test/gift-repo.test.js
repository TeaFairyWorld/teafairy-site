const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

test("gift pages and functions do not call the previous project", () => {
  const files = walk(root, []).filter((full) => {
    const rel = path.relative(root, full);
    return !rel.startsWith("admin/") && rel !== "404.html" && !rel.startsWith("test/");
  });
  const hits = files.filter((full) => fs.readFileSync(full).includes("lqghuvaazdnqzkbagbay"));
  assert.deepEqual(hits.map((full) => path.relative(root, full)), []);
});

test("the withdrawn plaintext migration is gone and the reviewed one is present", () => {
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/20261106124500_gift_submissions.sql")), false);
  const sql = read("supabase/migrations/20261106150000_gift_redeem.sql");
  assert.match(sql, /tkxepmevhhzfmorbhriz/);
  assert.doesNotMatch(sql, /gift_save_submission|reference_code/);
  assert.match(sql, /gift_private\.addresses/);
  assert.match(sql, /GP01/);
  assert.match(sql, /TP01/);
  assert.match(sql, /security definer/);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /[0-9a-f]{64}/);
  assert.doesNotMatch(sql, /issue_batch\('(?:production|test)'\)/);
  const executable = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
  assert.doesNotMatch(executable, /grant\s+[^;]*\sto\s+anon/i);
  assert.match(sql, /grant execute on function public\.gift_redeem\(jsonb\) to service_role/);
  assert.match(sql, /grant execute on function gift_private\.redeem\(jsonb\) to service_role/);
  assert.doesNotMatch(sql, /grant execute on function gift_private\.issue_batch/);
  assert.doesNotMatch(sql, /grant execute on function gift_private\.distribution_list/);
  assert.doesNotMatch(sql, /grant (select|insert|update|all) on (table )?gift_private/i);
});

test("frontend stays disabled and does not store the code or address", () => {
  const config = read("js/gift-config.js");
  assert.match(config, /submissionsEnabled:\s*false/);
  assert.match(config, /tkxepmevhhzfmorbhriz\.supabase\.co\/functions\/v1\/gift-submit/);
  const page = read("redeem.html");
  assert.match(page, /不能接收真实地址/);
  assert.match(page, /does not include a standard gift/);
  assert.match(page, /images\/cbbc-approved-logo\.png/);
  assert.match(page, /images\/logo\.png/);
  assert.match(page, /disabled/);
  for (const rel of ["js/gift-config.js", "js/gift-code.js", "js/gift-flow.js", "redeem.js", "redeem.html"]) {
    const text = read(rel);
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie|console\.log/);
    assert.doesNotMatch(text, /VOUCHER_PEPPER|service_role/);
  }
});

test("the anon key on the gift page is the new project's anon key", () => {
  const source = read("redeem.js");
  const token = source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  assert.ok(token);
  const payload = JSON.parse(Buffer.from(token[0].split(".")[1], "base64url").toString());
  assert.equal(payload.role, "anon");
  assert.equal(payload.ref, "tkxepmevhhzfmorbhriz");
});

test("secret file is ignored and the example has no pepper", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /supabase\/\.env/);
  const example = read("supabase/.env.example");
  assert.match(example, /^VOUCHER_PEPPER=$/m);
  assert.match(example, /tkxepmevhhzfmorbhriz/);
  assert.equal(fs.existsSync(path.join(root, "supabase/.env")), false);
  const handler = read("supabase/functions/gift-submit/handler.mjs");
  assert.match(handler, /VOUCHER_PEPPER/);
  assert.doesNotMatch(handler, /GIFT_CODE_PEPPER/);
  assert.match(handler, /tkxepmevhhzfmorbhriz/);
});

test("gift logos put the trade-association mark first", () => {
  const page = read("redeem.html");
  const block = page.slice(page.indexOf("redeem-logos"), page.indexOf("</div>", page.indexOf("redeem-logos")));
  const sources = [...block.matchAll(/src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sources, ["images/cbbc-approved-logo.png", "images/logo.png"]);
  assert.match(page, /<header><nav><a class="brand" href="index.html"><img src="images\/logo.png"/);
  const logo = fs.readFileSync(path.join(root, "images/cbbc-approved-logo.png"));
  assert.equal(logo.toString("ascii", 12, 16), "IHDR");
  assert.equal(logo.readUInt32BE(16), 753);
  assert.equal(logo.readUInt32BE(20), 315);
});
