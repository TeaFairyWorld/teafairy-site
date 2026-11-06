import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateGiftCode() {
  const bytes = randomBytes(20);
  const chars = [...bytes].map((byte) => ALPHABET[byte & 31]);
  return [0, 5, 10, 15].map((start) => chars.slice(start, start + 5).join("")).join("-");
}

export function assertOutsideRepo(file) {
  const repo = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  const resolved = path.resolve(file);
  const relative = path.relative(repo, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("refusing to write codes inside the repository");
  }
}

function main() {
  const out = process.env.GIFT_CODES_OUT;
  if (!out) {
    console.error("Set GIFT_CODES_OUT to a private path outside this repository.");
    process.exit(1);
  }
  assertOutsideRepo(out);
  const codes = Array.from({ length: 20 }, () => generateGiftCode());
  writeFileSync(out, codes.join("\n") + "\n", { mode: 0o600 });
  console.log("Wrote 20 codes to the path you gave. They were not printed. Load them into REDEEM_CODES in a private shell, provision, then delete the file.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
