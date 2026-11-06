import { pathToFileURL } from "node:url";
import { hmacSha256, toHex, normalizeCode } from "../supabase/functions/_shared/gift_logic.ts";

export function reviewCodes(raw, options = {}) {
  const parts = String(raw || "").split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 20) return { ok: false, error: "expected 20 codes" };
  const codes = [];
  for (const part of parts) {
    const code = normalizeCode(part);
    if (!code) return { ok: false, error: "a code failed the format check" };
    if (code.includes("TEST-ONLY") && !options.allowFixtures) {
      return { ok: false, error: "fixture codes are not accepted" };
    }
    if (code.length < 21 && !options.allowFixtures) {
      return { ok: false, error: "a code is shorter than 21 characters" };
    }
    codes.push(code);
  }
  if (new Set(codes).size !== codes.length) return { ok: false, error: "codes are not unique" };
  return { ok: true, codes };
}

function localUrl(value) {
  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const pepper = process.env.GIFT_CODE_PEPPER || "";
  if (!url || !key || pepper.length < 16) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GIFT_CODE_PEPPER are required. No codes were sent.");
    process.exit(1);
  }
  const allowFixtures = process.env.GIFT_ALLOW_TEST_FIXTURES === "1" && localUrl(url);
  const reviewed = reviewCodes(process.env.REDEEM_CODES || "", { allowFixtures });
  if (!reviewed.ok) {
    console.error(reviewed.error);
    process.exit(1);
  }
  const hashes = [];
  for (const code of reviewed.codes) hashes.push(toHex(await hmacSha256(pepper, code)));
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/gift_provision_hex`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ p_hashes: hashes }),
  });
  if (!response.ok) {
    console.error(`provision failed with HTTP ${response.status}`);
    process.exit(1);
  }
  const body = await response.json();
  console.log(`provisioned inserted=${body.inserted} total=${body.total}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
