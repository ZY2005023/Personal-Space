import { z } from "zod";
import { requireAdminSession, ok, problem, readJson } from "@/lib/http";
import { DomainError } from "@/lib/domain";
import { ReauthOperation, tokenHash, type SecurityContext } from "@/lib/auth-policy";
import { beginMfaReplacement, cancelMfaReplacement, changePassword, confirmMfaReplacement, reauthenticate, resetRecoveryCodes, revokeSessions } from "@/lib/security-store";
import { beginRecoveryMfa } from "@/lib/recovery-login";
import { logRequest } from "@/lib/logger";
export const dynamic = "force-dynamic";
const proof = z.string().regex(/^[a-f0-9]{64}$/);
async function handle(request: Request, context: { params: Promise<{ action: string }> }, requestId: string) {
  try {
    const session = await requireAdminSession(request);
    if (!session.csrfToken || !session.sessionVersion) throw new DomainError(401, "UNAUTHENTICATED", "请重新登录");
    const security: SecurityContext = { adminId: session.user.id, sessionHash: tokenHash(session.csrfToken), sessionVersion: session.sessionVersion };
    const { action } = await context.params;
    if (!["reauthenticate", "password", "recovery-codes", "revoke-sessions", "mfa-start", "mfa-confirm", "mfa-cancel", "recovery-mfa-start"].includes(action)) throw new DomainError(404, "NOT_FOUND", "接口不存在");
    const raw = await readJson(request);
    if (action === "recovery-mfa-start") { const body = z.strictObject({ password: z.string().min(1).max(1024) }).parse(raw); return ok(await beginRecoveryMfa(security, body.password)); }
    if (action === "reauthenticate") {
      const body = z.strictObject({ operation: ReauthOperation, password: z.string().min(1).max(1024), code: z.string().min(1).max(128), recovery: z.boolean() }).parse(raw);
      return ok(await reauthenticate(security, body, body.operation));
    }
    if (action === "password") { const body = z.strictObject({ token: proof, newPassword: z.string() }).parse(raw); return ok(await changePassword(security, body.token, body.newPassword)); }
    if (action === "mfa-cancel") { const body = z.strictObject({ bindingToken: proof }).parse(raw); return ok(await cancelMfaReplacement(security, body.bindingToken)); }
    if (action === "mfa-confirm") { const body = z.strictObject({ bindingToken: proof, code: z.string().regex(/^\d{6}$/) }).parse(raw); return ok(await confirmMfaReplacement(security, body.bindingToken, body.code)); }
    const body = z.strictObject({ token: proof }).parse(raw);
    if (action === "recovery-codes") return ok(await resetRecoveryCodes(security, body.token));
    if (action === "mfa-start") return ok(await beginMfaReplacement(security, body.token));
    return ok(await revokeSessions(security, body.token));
  } catch (e) { return problem(e, requestId); }
}
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const startedAt = Date.now(), requestId = crypto.randomUUID();
  try {
    const response = await handle(request, context, requestId);
    logRequest(request, response.status, startedAt, requestId);
    return response;
  } catch (error) {
    const response = problem(error, requestId);
    logRequest(request, response.status, startedAt, requestId, error instanceof DomainError ? error.code : "INTERNAL_ERROR");
    return response;
  }
}
