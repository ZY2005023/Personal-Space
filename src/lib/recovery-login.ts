import type { AdminUser } from "@/generated/prisma/client";
import { db } from "./db";
import { csrfForNonce, denied, newTotp, reauthRequired, recoveryToken, tokenHash, totpUri, verifyPassword, type SecurityContext } from "./auth-policy";
import { decryptSecret, encryptSecret } from "./crypto";
import { throttle } from "./credentials-store";
import { consumeProof, lockAdmin } from "./security-store";
import type { Tx } from "./reference-store";
type Client = Pick<ReturnType<typeof db>, "$queryRaw" | "$transaction" | "adminUser">;
/** Call only inside the successful recovery-code login transaction, before JWT issuance. */
export async function recordRecoveryLogin(tx: Tx, admin: AdminUser, csrfNonce: string) {
  const context = { adminId: admin.id, sessionHash: tokenHash(csrfForNonce(csrfNonce)), sessionVersion: admin.sessionVersion };
  await tx.securityChallenge.create({ data: { adminId: admin.id, tokenHash: tokenHash(recoveryToken("login", context)), purpose: "RECOVERY_LOGIN", operation: "MFA_REPLACE", sessionHash: context.sessionHash, sessionVersion: context.sessionVersion, expiresAt: new Date(Date.now() + 300000) } });
}
/** Fresh recovery-code evidence is single-use and grants only one MFA replacement, never a password change. */
export async function beginRecoveryMfa(context: SecurityContext, password: string, client: Client = db()) {
  await throttle("recovery-reauth:" + context.adminId, client);
  const before = await client.adminUser.findUnique({ where: { id: context.adminId } });
  const valid = await verifyPassword(before?.passwordHash, password);
  if (!before || !before.mfaEnabled || before.sessionVersion !== context.sessionVersion || !valid) throw denied();
  const loginToken = recoveryToken("login", context), bindingToken = recoveryToken("binding", context);
  return client.$transaction(async tx => {
    const admin = await lockAdmin(tx, context);
    if (admin.passwordHash !== before.passwordHash) throw denied();
    const evidence = await tx.securityChallenge.findUnique({ where: { tokenHash: tokenHash(loginToken) } });
    if (!evidence || evidence.adminId !== context.adminId || evidence.sessionHash !== context.sessionHash || evidence.sessionVersion !== context.sessionVersion || evidence.purpose !== "RECOVERY_LOGIN" || evidence.operation !== "MFA_REPLACE") throw reauthRequired();
    // Database time enforces the original absolute five-minute deadline, including retries.
    const live = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM security_challenges WHERE id = ${evidence.id}::uuid AND expires_at > clock_timestamp()`;
    if (live.length !== 1) throw reauthRequired();
    if (evidence.usedAt) {
      const pending = await tx.securityChallenge.findUnique({ where: { tokenHash: tokenHash(bindingToken) } });
      if (!pending || pending.usedAt || !pending.encryptedPayload || pending.purpose !== "MFA_BINDING" || pending.operation !== "MFA_REPLACE" || pending.adminId !== context.adminId || pending.sessionHash !== context.sessionHash || pending.sessionVersion !== context.sessionVersion || pending.expiresAt.getTime() !== evidence.expiresAt.getTime()) throw reauthRequired();
      const secret = decryptSecret(pending.encryptedPayload, "mfa-enrollment");
      return { bindingToken, secret, uri: totpUri(admin.username, secret), expiresAt: pending.expiresAt.toISOString() };
    }
    await consumeProof(tx, context, loginToken, "RECOVERY_LOGIN", "MFA_REPLACE");
    await tx.securityChallenge.updateMany({ where: { adminId: context.adminId, purpose: "MFA_BINDING", usedAt: null }, data: { usedAt: new Date(), encryptedPayload: null } });
    const enrollment = newTotp(admin.username);
    await tx.securityChallenge.create({ data: { adminId: admin.id, tokenHash: tokenHash(bindingToken), purpose: "MFA_BINDING", operation: "MFA_REPLACE", sessionHash: context.sessionHash, sessionVersion: context.sessionVersion, encryptedPayload: encryptSecret(enrollment.secret, "mfa-enrollment"), expiresAt: evidence.expiresAt } });
    await tx.auditLog.create({ data: { actorId: admin.id, action: "RECOVERY_MFA_STARTED", targetType: "ADMIN", targetId: admin.id, metadata: { operation: "MFA_REPLACE" } } });
    return { bindingToken, secret: enrollment.secret, uri: enrollment.uri, expiresAt: evidence.expiresAt.toISOString() };
  });
}
