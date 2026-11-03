import { db } from "./db";
import { DomainError } from "./domain";
import { encryptTotp, matchTotp } from "./crypto";
import { hashPassword, newRecoveryCodes, newTotp, Username } from "./auth-policy";
export async function prepareAdministrator(username: string, password: string) {
  const normalized = Username.parse(username), passwordHash = await hashPassword(password), enrollment = newTotp(normalized), recovery = await newRecoveryCodes();
  return { username: normalized, passwordHash, ...enrollment, recoveryCodes: recovery.codes, recoveryHashes: recovery.hashes };
}
export async function initializeAdministrator(prepared: Awaited<ReturnType<typeof prepareAdministrator>>, code: string, client: Pick<ReturnType<typeof db>, "$transaction"> = db(), now = Date.now()) {
  const step = matchTotp(prepared.secret, code.trim(), now);
  if (step === null) throw new DomainError(422, "INVALID_INPUT", "双因素验证未通过，未创建管理员");
  const encrypted = encryptTotp(prepared.secret);
  await client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-space:admin-initialization', 0))::text`;
    if (await tx.adminUser.count() !== 0) throw new DomainError(409, "FORBIDDEN", "管理员已经存在，不能再次初始化");
    const admin = await tx.adminUser.create({ data: { singletonKey: 1, username: prepared.username, passwordHash: prepared.passwordHash, mfaEnabled: true, totpSecretEncrypted: encrypted, lastTotpStep: BigInt(step), sessionVersion: 1 } });
    await tx.recoveryCode.createMany({ data: prepared.recoveryHashes.map(codeHash => ({ adminId: admin.id, codeHash })) });
    await tx.auditLog.create({ data: { actorId: admin.id, action: "ADMIN_INITIALIZED", targetType: "ADMIN", targetId: admin.id, metadata: { mfaEnabled: true, recoveryCodeCount: prepared.recoveryHashes.length } } });
  });
  return { username: prepared.username, recoveryCodes: prepared.recoveryCodes };
}
