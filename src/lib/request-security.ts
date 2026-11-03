import { DomainError } from "./domain";
import { equal } from "./crypto";
export function assertWriteProof(request: Request, csrfToken: string | undefined) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const allowed = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : new URL(request.url).origin;
  if (request.headers.get("origin") !== allowed || !csrfToken || !equal(csrfToken, request.headers.get("x-csrf-token") || "")) throw new DomainError(403, "FORBIDDEN", "请求验证失败，请刷新页面后重试");
}
