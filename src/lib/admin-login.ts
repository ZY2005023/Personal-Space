import { randomUUID } from "node:crypto";
import { db } from "./db";
import { CredentialsInput } from "./auth-policy";
import { withCredentials } from "./credentials-store";
import { recordRecoveryLogin } from "./recovery-login";
export async function loginAdministrator(raw: unknown, client: Pick<ReturnType<typeof db>, "$queryRaw" | "$transaction" | "adminUser"> = db()) {
  const input = CredentialsInput.parse(raw), csrfNonce = randomUUID();
  return withCredentials(input, "LOGIN", async (tx, admin) => {
    if (input.recovery) await recordRecoveryLogin(tx, admin, csrfNonce);
    await tx.auditLog.create({ data: { actorId: admin.id, action: "SIGNED_IN", targetType: "ADMIN", targetId: admin.id, metadata: { recoveryUsed: input.recovery } } });
    return { id: admin.id, name: admin.username, sessionVersion: admin.sessionVersion, csrfNonce };
  }, undefined, client);
}
