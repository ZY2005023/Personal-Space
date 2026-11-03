import type { AdminUser } from "@/generated/prisma/client";
import { db } from "./db";
import { decryptTotp, matchTotp } from "./crypto";
import { DomainError } from "./domain";
import { CredentialsInput, denied, verifyHash, verifyPassword } from "./auth-policy";
import type { Tx } from "./reference-store";
type Client = Pick<ReturnType<typeof db>, "$queryRaw" | "$transaction" | "adminUser">;
export async function throttle(key: string, client: Pick<Client, "$queryRaw"> = db()) {
  const rows = await client.$queryRaw<{ attempts: number }[]>`
    INSERT INTO login_throttles (key, attempts, window_start) VALUES (${key}, 1, clock_timestamp())
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN login_throttles.window_start < clock_timestamp() - INTERVAL '15 minutes' THEN 1 ELSE login_throttles.attempts + 1 END,
      window_start = CASE WHEN login_throttles.window_start < clock_timestamp() - INTERVAL '15 minutes' THEN clock_timestamp() ELSE login_throttles.window_start END
    RETURNING attempts`;
  if (!rows.length || rows[0].attempts > 10) throw new DomainError(429, "RATE_LIMITED", "尝试次数过多，请15分钟后重试");
}
export async function withCredentials<T>(input: unknown, purpose: "LOGIN" | "REAUTH", use: (tx: Tx, admin: AdminUser) => Promise<T>, expected?: { id: string; sessionVersion: number }, client: Client = db(), now = Date.now()) {
  const credentials = CredentialsInput.parse(input);
  // Attempts commit independently, even if a later password/factor transaction fails.
  await throttle(purpose === "LOGIN" ? "admin" : "reauth:" + expected?.id, client);
  const before = await client.adminUser.findUnique({ where: { username: credentials.username.trim().toLowerCase() } });
  const passwordValid = await verifyPassword(before?.passwordHash, credentials.password);
  if (!before || !before.mfaEnabled || !before.totpSecretEncrypted || expected && (before.id !== expected.id || before.sessionVersion !== expected.sessionVersion) || !passwordValid) throw denied();
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM admin_users WHERE id = ${before.id}::uuid FOR UPDATE`;
    const admin = await tx.adminUser.findUniqueOrThrow({ where: { id: before.id } });
    if (!admin.mfaEnabled || admin.sessionVersion !== before.sessionVersion || admin.passwordHash !== before.passwordHash || admin.totpSecretEncrypted !== before.totpSecretEncrypted) throw denied();
    if (credentials.recovery) {
      const codes = await tx.recoveryCode.findMany({ where: { adminId: admin.id, usedAt: null }, take: 10 });
      let id: string | null = null;
      for (const code of codes) if (await verifyHash(code.codeHash, credentials.code.trim().toLowerCase())) { id = code.id; break; }
      if (!id || (await tx.recoveryCode.updateMany({ where: { id, adminId: admin.id, usedAt: null }, data: { usedAt: new Date(now) } })).count !== 1) throw denied();
    } else {
      const step = matchTotp(decryptTotp(admin.totpSecretEncrypted!), credentials.code.trim(), now);
      if (step === null || (await tx.adminUser.updateMany({ where: { id: admin.id, sessionVersion: admin.sessionVersion, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: BigInt(step) } }] }, data: { lastTotpStep: BigInt(step) } })).count !== 1) throw denied();
    }
    return use(tx, admin);
  }, { timeout: 15000 });
}
