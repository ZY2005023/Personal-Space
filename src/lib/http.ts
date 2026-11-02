import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { auth } from "@/auth";
import { DomainError } from "./domain";
import { equal } from "./crypto";
export function ok(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json({ data }, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}
export function problem(error: unknown) {
  const domain = error instanceof DomainError ? error : error instanceof ZodError ? new DomainError(422, "INVALID_INPUT", "请检查填写的内容") : new DomainError(503, "SERVICE_UNAVAILABLE", "服务暂不可用，请稍后重试");
  return Response.json({ type: "about:blank", title: domain.message, detail: domain.message, status: domain.status, code: domain.code, requestId: randomUUID(), ...(error instanceof ZodError ? { errors: error.issues.map(i => ({ pointer: "/" + i.path.join("/"), message: i.message })) } : {}) }, { status: domain.status, headers: { "Content-Type": "application/problem+json", "Cache-Control": "private, no-store" } });
}
export async function requireAdmin(request: Request) {
  if (!process.env.AUTH_SECRET || !process.env.DATABASE_URL || !process.env.TOTP_ENCRYPTION_KEY) throw new DomainError(401, "UNAUTHENTICATED", "请先完成管理员与安全配置");
  const session = await auth();
  if (!session?.user?.id) throw new DomainError(401, "UNAUTHENTICATED", "请先登录并完成双因素认证");
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const allowed = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : new URL(request.url).origin;
    if (origin !== allowed || !session.csrfToken || !equal(session.csrfToken, request.headers.get("x-csrf-token") || "")) throw new DomainError(403, "FORBIDDEN", "请求验证失败，请刷新页面后重试");
  }
  return session.user.id;
}
export function key(request: Request) {
  const value = request.headers.get("idempotency-key");
  if (!value || value.length < 16 || value.length > 200) throw new DomainError(400, "INVALID_INPUT", "请提供有效的请求标识"); return value;
}
export async function readJson(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new DomainError(400, "INVALID_INPUT", "缺少请求内容");
  const decoder = new TextDecoder(); let length = 0, text = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new DomainError(413, "PAYLOAD_TOO_LARGE", "内容过大"); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch { throw new DomainError(400, "INVALID_INPUT", "请求格式错误"); }
}
