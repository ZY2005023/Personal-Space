import { randomUUID } from "node:crypto";
import type { AdminUser, SecurityChallenge, RecoveryCode } from "../../src/generated/prisma/client";
import { hashPassword, tokenHash } from "../../src/lib/auth-policy";
import { encryptTotp } from "../../src/lib/crypto";
import { db } from "../../src/lib/db";
export const adminId = "10000000-0000-4000-8000-000000000001", password = "test-only-password-for-fixtures", secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
export const context = { adminId, sessionHash: tokenHash("test-session-a"), sessionVersion: 1 };
export async function authFixture(empty = false) {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const state = { admin: empty ? null : { id: adminId, singletonKey: 1, username: "owner", passwordHash: await hashPassword(password), mfaEnabled: true, totpSecretEncrypted: encryptTotp(secret), lastTotpStep: null, sessionVersion: 1, createdAt: new Date(), updatedAt: new Date() } as AdminUser | null, challenges: [] as SecurityChallenge[], codes: [] as RecoveryCode[], audits: [] as unknown[], failAudit: false, beforeTransaction: null as (() => void) | null };
  const attempts = new Map<string, number>();
  const copy = <T,>(value: T): T => structuredClone(value);
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("");
      if (sql.includes("INSERT INTO login_throttles")) { const key = String(values[0]), n = (attempts.get(key) || 0) + 1; attempts.set(key, n); return [{ attempts: n }]; }
      if (sql.includes("SELECT id FROM security_challenges")) { const row = state.challenges.find(c => c.id === values[0] && c.expiresAt > new Date()); return row ? [{ id: row.id }] : []; }
      if (sql.includes("UPDATE security_challenges")) {
        const [hash, id, sessionHash, version, purpose, operation] = values;
        const row = state.challenges.find(c => c.tokenHash === hash && c.adminId === id && c.sessionHash === sessionHash && c.sessionVersion === version && c.purpose === purpose && c.operation === operation && !c.usedAt && c.expiresAt > new Date());
        if (!row) return []; row.usedAt = new Date(); row.encryptedPayload = null; return [{ id: row.id }];
      }
      return [];
    },
    adminUser: {
      count: async () => state.admin ? 1 : 0,
      findUnique: async ({ where }: { where: { id?: string; username?: string } }) => state.admin && (where.id === state.admin.id || where.username === state.admin.username) ? copy(state.admin) : null,
      findUniqueOrThrow: async () => { if (!state.admin) throw new Error("Missing admin"); return copy(state.admin); },
      create: async ({ data }: { data: Partial<AdminUser> }) => { state.admin = { id: adminId, createdAt: new Date(), updatedAt: new Date(), ...data } as AdminUser; return copy(state.admin); },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        const { sessionVersion, ...fields } = data; Object.assign(state.admin!, fields);
        if (sessionVersion) state.admin!.sessionVersion += (sessionVersion as { increment: number }).increment;
        return copy(state.admin!);
      },
      updateMany: async ({ where, data }: { where: { id: string; sessionVersion?: number; OR?: unknown }; data: { lastTotpStep?: bigint; sessionVersion?: { increment: number } } }) => {
        if (!state.admin || where.id !== state.admin.id || where.sessionVersion !== undefined && where.sessionVersion !== state.admin.sessionVersion) return { count: 0 };
        if (data.lastTotpStep !== undefined) { if (state.admin.lastTotpStep !== null && state.admin.lastTotpStep >= data.lastTotpStep) return { count: 0 }; state.admin.lastTotpStep = data.lastTotpStep; }
        if (data.sessionVersion) state.admin.sessionVersion += data.sessionVersion.increment;
        return { count: 1 };
      },
    },
    securityChallenge: {
      create: async ({ data }: { data: Partial<SecurityChallenge> }) => { const row = { id: randomUUID(), createdAt: new Date(), usedAt: null, encryptedPayload: null, ...data } as SecurityChallenge; state.challenges.push(row); return copy(row); },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => copy(state.challenges.find(c => c.tokenHash === where.tokenHash) || null),
      updateMany: async ({ where, data }: { where: { adminId: string; purpose?: string }; data: Partial<SecurityChallenge> }) => { for (const c of state.challenges) if (c.adminId === where.adminId && !c.usedAt && (!where.purpose || c.purpose === where.purpose)) Object.assign(c, data); return { count: 1 }; },
    },
    recoveryCode: {
      findMany: async () => copy(state.codes.filter(c => !c.usedAt)),
      updateMany: async ({ where, data }: { where: { id: string }; data: Partial<RecoveryCode> }) => { const c = state.codes.find(c => c.id === where.id && !c.usedAt); if (!c) return { count: 0 }; Object.assign(c, data); return { count: 1 }; },
      deleteMany: async () => { state.codes = []; },
      createMany: async ({ data }: { data: Partial<RecoveryCode>[] }) => { state.codes.push(...data.map(d => ({ id: randomUUID(), createdAt: new Date(), usedAt: null, ...d } as RecoveryCode))); },
    },
    auditLog: { create: async ({ data }: { data: unknown }) => { if (state.failAudit) throw new Error("Simulated audit failure"); state.audits.push(copy(data)); } },
  };
  const client = { ...tx, $transaction: async (fn: (tx: unknown) => unknown) => {
    state.beforeTransaction?.(); state.beforeTransaction = null;
    const before = copy({ admin: state.admin, challenges: state.challenges, codes: state.codes, audits: state.audits });
    try { return await fn(tx); } catch (e) { Object.assign(state, before); throw e; }
  } } as unknown as ReturnType<typeof db>;
  return { state, attempts, client, tx };
}
