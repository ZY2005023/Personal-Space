import { createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";
export function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function base32(value: string) {
  let bits = "";
  for (const c of value.toUpperCase().replace(/=+$/, "")) { const n = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c); if (n < 0) throw new Error("Invalid base32"); bits += n.toString(2).padStart(5, "0"); }
  return Buffer.from((bits.match(/.{8}/g) || []).map(x => parseInt(x, 2)));
}
export function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const bytes = createHmac("sha1", base32(secret)).update(counter).digest(); const offset = bytes[19] & 15;
  return ((bytes.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
export function matchTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30_000);
  for (const candidate of [step, step - 1, step + 1]) if (candidate >= 0 && equal(totp(secret, candidate), code)) return candidate;
  return null;
}
export function decryptTotp(value: string) {
  const key = Buffer.from(process.env.TOTP_ENCRYPTION_KEY || "", "base64"); if (key.length !== 32) throw new Error("TOTP encryption key is not configured");
  const [iv, tag, ciphertext] = value.split(".").map(x => Buffer.from(x, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key, iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8");
}
