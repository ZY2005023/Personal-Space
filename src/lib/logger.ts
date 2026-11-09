type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

/** One JSON object per line. Callers must never pass credentials, bodies or query strings. */
export function log(level: Level, event: string, fields: Fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logRequest(request: Request, status: number, startedAt: number, requestId: string, code?: string) {
  const path = new URL(request.url).pathname;
  log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "http.request", {
    requestId, method: request.method, path, status, durationMs: Date.now() - startedAt, ...(code ? { code } : {}),
  });
}