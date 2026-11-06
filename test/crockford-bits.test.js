const test = require("node:test");
const assert = require("node:assert/strict");

const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeStreaming(bytes) {
  let acc = 0n;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    acc = (acc << 8n) | BigInt(byte);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPH[Number((acc >> BigInt(bits)) & 31n)];
    }
  }
  if (bits > 0) out += ALPH[Number((acc << BigInt(5 - bits)) & 31n)];
  return out;
}

function encodePadded(bytes) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  bits += "00";
  let out = "";
  for (let i = 0; i < 26; i++) out += ALPH[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out;
}

test("16-byte Crockford encoders agree, including padding", () => {
  const samples = [
    new Uint8Array(16),
    Uint8Array.from({ length: 16 }, () => 255),
    Uint8Array.from({ length: 16 }, (_, i) => i * 17)
  ];
  for (const sample of samples) {
    const code = encodeStreaming(sample);
    assert.equal(code, encodePadded(sample));
    assert.equal(code.length, 26);
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  }
});
