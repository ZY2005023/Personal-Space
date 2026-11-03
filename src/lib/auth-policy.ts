import { randomBytes, createHash, createHmac } from "node:crypto";
import { hash, verify, type Options } from "@node-rs/argon2";
import { generateSecret, generateURI } from "otplib";
import { z } from "zod";
import { DomainError } from "./domain";
export const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
export const NewPassword = z.string().refine(v => Array.from(v).length >= 15 && Array.from(v).length <= 128 && !v.includes("\0"), "密码须为15至128个字符");
export const CredentialsInput = z.strictObject({ username: z.string().min(1).max(100), password: z.string().min(1).max(1024), code: z.string().min(1).max(128), recovery: z.boolean().default(false) });
export const ReauthOperation = z.enum(["PASSWORD_CHANGE", "MFA_REPLACE", "RECOVERY_RESET", "SESSIONS_REVOKE", "EXPORT_CREATE", "BACKUP_CREATE"]);
export type Operation = z.infer<typeof ReauthOperation>;
export type SecurityContext = { adminId: string; sessionHash: string; sessionVersion: number };
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
// Binding enum values: algorithm 2 = Argon2id; version 1 = Argon2 v0x13.
export const argonOptions: Options = { algorithm: 2, version: 1, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };
export const hashPassword = (password: string) => hash(NewPassword.parse(password), argonOptions);
export async function verifyHash(encoded: string, value: string) { try { return await verify(encoded, value); } catch { return false; } }
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(encoded: string | undefined, value: string) {
  if (!encoded) dummyHash ||= hash(randomBytes(32), argonOptions);
  return verifyHash(encoded || await dummyHash!, value);
}
export async function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString("hex").match(/.{4}/g)!.join("-"));
  const hashes = []; for (const code of codes) hashes.push(await hash(code, argonOptions));
  return { codes, hashes };
}
export function newTotp(username: string) {
  const secret = generateSecret({ length: 20 });
  return { secret, uri: generateURI({ issuer: "Personal Space", label: username, secret, algorithm: "sha1", digits: 6, period: 30 }) };
}
export const denied = () => new DomainError(401, "UNAUTHENTICATED", "验证未通过，请检查登录信息或稍后重试");
export const reauthRequired = () => new DomainError(403, "REAUTH_REQUIRED", "请为此操作重新验证身份");

export function csrfForNonce(nonce: string) {
  const key = process.env.AUTH_SECRET;
  if (!key) throw new DomainError(503, "SERVICE_UNAVAILABLE", "会话签名尚未配置");
  return createHmac("sha256", key).update(nonce).digest("hex");
}
export function recoveryToken(purpose: "login" | "binding", context: SecurityContext) {
  const key = process.env.AUTH_SECRET;
  if (!key || Buffer.byteLength(key) < 32) throw new DomainError(503, "SERVICE_UNAVAILABLE", "恢复验证签名尚未配置");
  return createHmac("sha256", key).update(JSON.stringify(["personal-space:recovery:v1", purpose, context.adminId, context.sessionHash, context.sessionVersion])).digest("hex");
}
export const totpUri = (username: string, secret: string) => generateURI({ issuer: "Personal Space", label: username, secret, algorithm: "sha1", digits: 6, period: 30 });
