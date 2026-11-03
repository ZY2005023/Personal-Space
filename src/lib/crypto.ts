import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { generateSync } from "otplib";
export function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function totp(secret: string, step: number) {
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("Invalid TOTP step");
  return generateSync({ secret, strategy: "totp", epoch: step * 30, algorithm: "sha1", digits: 6, period: 30 });
}
export function matchTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30_000);
  for (const candidate of [step, step - 1, step + 1]) if (candidate >= 0 && equal(totp(secret, candidate), code)) return candidate;
  return null;
}
function encryptionKey() {
  const value = process.env.TOTP_ENCRYPTION_KEY || "", key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new Error("TOTP encryption key is not configured"); return key;
}
export function encryptSecret(value: string, purpose: "totp" | "mfa-enrollment") {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from("personal-space:v1:" + purpose));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptSecret(value: string, purpose: "totp" | "mfa-enrollment") {
  const parts = value.split("."); if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error("Invalid encrypted secret");
  const [iv, tag, ciphertext] = parts.slice(1).map(x => Buffer.from(x, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted secret");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv); cipher.setAAD(Buffer.from("personal-space:v1:" + purpose)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8");
}
export const encryptTotp = (value: string) => encryptSecret(value, "totp");
export const decryptTotp = (value: string) => decryptSecret(value, "totp");
