import { db } from "./db";
import { DomainError } from "./domain";
import { decryptSecret, encryptSecret, encryptTotp, matchTotp } from "./crypto";
import { denied, hashPassword, newRecoveryCodes, newToken, newTotp, reauthRequired, tokenHash, type Operation, type SecurityContext } from "./auth-policy";
import { throttle, withCredentials } from "./credentials-store";
import type { Tx } from "./reference-store";
type Client = Pick<ReturnType<typeof db>, "$transaction" | "$queryRaw" | "adminUser" | "securityChallenge">;
export async function lockAdmin(tx: Tx, context: SecurityContext) {
  await tx.$queryRaw`SELECT id FROM admin_users WHERE id = ${context.adminId}::uuid FOR UPDATE`;
  const admin = await tx.adminUser.findUniqueOrThrow({ where: { id: context.adminId } });
  if (!admin.mfaEnabled || admin.sessionVersion !== context.sessionVersion) throw denied(); return admin;
}
export async function consumeProof(tx: Tx, context: SecurityContext, token: string, purpose: "REAUTH" | "MFA_BINDING" | "RECOVERY_LOGIN", operation: Operation) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw reauthRequired();
  const h = tokenHash(token);
  const consumed = await tx.$queryRaw<{ id: string }[]>`UPDATE security_challenges SET used_at = clock_timestamp(), encrypted_payload = NULL
    WHERE token_hash = ${h} AND admin_id = ${context.adminId}::uuid AND session_hash = ${context.sessionHash}
      AND session_version = ${context.sessionVersion} AND purpose = ${purpose} AND operation = ${operation}
      AND used_at IS NULL AND expires_at > clock_timestamp() RETURNING id`;
  if (consumed.length !== 1) throw reauthRequired();
}
async function invalidateProofs(tx: Tx, adminId: string) {
  await tx.securityChallenge.updateMany({ where: { adminId, usedAt: null }, data: { usedAt: new Date(), encryptedPayload: null } });
}
async function rotateCodes(tx: Tx, adminId: string, hashes: string[]) {
  await tx.recoveryCode.deleteMany({ where: { adminId } });
  await tx.recoveryCode.createMany({ data: hashes.map(codeHash => ({ adminId, codeHash })) });
}
async function revoke(tx: Tx, context: SecurityContext, action: string, fields: { passwordHash?: string; totpSecretEncrypted?: string; lastTotpStep?: bigint } = {}) {
  await tx.adminUser.update({ where: { id: context.adminId }, data: { ...fields, sessionVersion: { increment: 1 } } });
  await invalidateProofs(tx, context.adminId);
  await tx.auditLog.create({ data: { actorId: context.adminId, action, targetType: "ADMIN", targetId: context.adminId, metadata: { sessionsRevoked: true } } });
}
export async function reauthenticate(context: SecurityContext, credentials: { password: string; code: string; recovery: boolean }, operation: Operation, client: Client = db()) {
  const admin = await client.adminUser.findUniqueOrThrow({ where: { id: context.adminId } });
  const token = newToken(), expiresAt = new Date(Date.now() + 300_000);
  return withCredentials({ password: credentials.password, code: credentials.code, recovery: credentials.recovery, username: admin.username }, "REAUTH", async (tx, current) => {
    await tx.securityChallenge.create({ data: { adminId: current.id, tokenHash: tokenHash(token), purpose: "REAUTH", operation, sessionHash: context.sessionHash, sessionVersion: current.sessionVersion, expiresAt } });
    await tx.auditLog.create({ data: { actorId: current.id, action: "REAUTHENTICATED", targetType: "ADMIN", targetId: current.id, metadata: { operation } } });
    return { token, operation, expiresAt: expiresAt.toISOString() };
  }, { id: context.adminId, sessionVersion: context.sessionVersion }, client);
}
export async function changePassword(context: SecurityContext, token: string, password: string, client: Client = db()) {
  const passwordHash = await hashPassword(password);
  await client.$transaction(async tx => { await lockAdmin(tx, context); await consumeProof(tx, context, token, "REAUTH", "PASSWORD_CHANGE"); await revoke(tx, context, "PASSWORD_CHANGED", { passwordHash }); });
  return { sessionsRevoked: true };
}
export async function resetRecoveryCodes(context: SecurityContext, token: string, client: Client = db()) {
  const recovery = await newRecoveryCodes();
  await client.$transaction(async tx => { await lockAdmin(tx, context); await consumeProof(tx, context, token, "REAUTH", "RECOVERY_RESET"); await rotateCodes(tx, context.adminId, recovery.hashes); await revoke(tx, context, "RECOVERY_CODES_RESET"); }, { timeout: 15000 });
  return { recoveryCodes: recovery.codes, sessionsRevoked: true };
}
export async function revokeSessions(context: SecurityContext, token: string, client: Client = db()) {
  await client.$transaction(async tx => { await lockAdmin(tx, context); await consumeProof(tx, context, token, "REAUTH", "SESSIONS_REVOKE"); await revoke(tx, context, "SESSIONS_REVOKED"); });
  return { sessionsRevoked: true };
}
export async function beginMfaReplacement(context: SecurityContext, token: string, client: Client = db()) {
  const bindingToken = newToken(), expiresAt = new Date(Date.now() + 600_000);
  return client.$transaction(async tx => {
    const admin = await lockAdmin(tx, context); await consumeProof(tx, context, token, "REAUTH", "MFA_REPLACE");
    const enrollment = newTotp(admin.username);
    await tx.securityChallenge.updateMany({ where: { adminId: context.adminId, purpose: "MFA_BINDING", usedAt: null }, data: { usedAt: new Date(), encryptedPayload: null } });
    await tx.securityChallenge.create({ data: { adminId: context.adminId, tokenHash: tokenHash(bindingToken), purpose: "MFA_BINDING", operation: "MFA_REPLACE", sessionHash: context.sessionHash, sessionVersion: context.sessionVersion, encryptedPayload: encryptSecret(enrollment.secret, "mfa-enrollment"), expiresAt } });
    return { bindingToken, secret: enrollment.secret, uri: enrollment.uri, expiresAt: expiresAt.toISOString() };
  });
}
export async function cancelMfaReplacement(context: SecurityContext, token: string, client: Client = db()) {
  await client.$transaction(async tx => { await lockAdmin(tx, context); await consumeProof(tx, context, token, "MFA_BINDING", "MFA_REPLACE"); });
  return { cancelled: true };
}
export async function confirmMfaReplacement(context: SecurityContext, token: string, code: string, client: Client = db(), now = Date.now()) {
  await throttle("mfa-confirm:" + context.adminId, client);
  if (!/^[a-f0-9]{64}$/.test(token)) throw reauthRequired();
  const enrollment = await client.securityChallenge.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!enrollment || enrollment.adminId !== context.adminId || enrollment.sessionHash !== context.sessionHash || enrollment.sessionVersion !== context.sessionVersion || enrollment.purpose !== "MFA_BINDING" || enrollment.operation !== "MFA_REPLACE" || enrollment.usedAt || enrollment.expiresAt <= new Date(now) || !enrollment.encryptedPayload) throw reauthRequired();
  const secret = decryptSecret(enrollment.encryptedPayload, "mfa-enrollment"), step = matchTotp(secret, code.trim(), now);
  if (step === null) throw denied();
  const recovery = await newRecoveryCodes();
  await client.$transaction(async tx => {
    await lockAdmin(tx, context); await consumeProof(tx, context, token, "MFA_BINDING", "MFA_REPLACE");
    await rotateCodes(tx, context.adminId, recovery.hashes);
    await revoke(tx, context, "MFA_REPLACED", { totpSecretEncrypted: encryptTotp(secret), lastTotpStep: BigInt(step) });
  }, { timeout: 15000 });
  return { recoveryCodes: recovery.codes, sessionsRevoked: true };
}
export async function revokeOnSignOut(adminId: string, sessionVersion: number, client: Client = db()) {
  await client.$transaction(async tx => {
    const changed = await tx.adminUser.updateMany({ where: { id: adminId, sessionVersion }, data: { sessionVersion: { increment: 1 } } });
    if (changed.count === 1) {
      await invalidateProofs(tx, adminId);
      await tx.auditLog.create({ data: { actorId: adminId, action: "SIGNED_OUT", targetType: "ADMIN", targetId: adminId, metadata: { sessionsRevoked: true } } });
    }
  });
}
