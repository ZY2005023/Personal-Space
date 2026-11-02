import { createHmac, randomBytes } from "node:crypto";
import { equal } from "./crypto";
import { DomainError, requestHash } from "./domain";
const devKey = randomBytes(32).toString("hex");
export type PagePosition = { id: string; publishedAt: string; score?: number };
function secret() {
  if (process.env.CURSOR_SECRET) return process.env.CURSOR_SECRET;
  if (process.env.NODE_ENV !== "production") return process.env.AUTH_SECRET || devKey;
  throw new DomainError(503, "SERVICE_UNAVAILABLE", "分页服务尚未配置");
}
export function decodePageCursor(cursor: string | null, filters: unknown): PagePosition | null {
  if (!cursor) return null;
  const key = secret();
  try {
    if (cursor.length > 2048) throw new Error();
    const [encoded, signature, extra] = cursor.split("."); if (!encoded || !signature || extra) throw new Error();
    if (!equal(signature, createHmac("sha256", key).update(encoded).digest("base64url"))) throw new Error();
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (value.v !== 1 || value.filter !== requestHash(filters) || typeof value.id !== "string" || !value.id || value.id.length > 100 || typeof value.publishedAt !== "string" || !Number.isFinite(Date.parse(value.publishedAt)) || new Date(value.publishedAt).toISOString() !== value.publishedAt || !Number.isSafeInteger(value.score) || value.score < 0) throw new Error();
    return { id: value.id, publishedAt: value.publishedAt, score: value.score };
  } catch { throw new DomainError(400, "INVALID_INPUT", "分页游标已失效，请重新加载列表"); }
}
export function finishPage<T extends PagePosition>(rows: T[], limit: number, filters: unknown) {
  const data = rows.slice(0, limit), hasMore = rows.length > limit;
  let nextCursor: string | null = null;
  if (hasMore) {
    const last = data.at(-1)!;
    const encoded = Buffer.from(JSON.stringify({ v: 1, id: last.id, publishedAt: last.publishedAt, score: last.score || 0, filter: requestHash(filters) })).toString("base64url");
    nextCursor = encoded + "." + createHmac("sha256", secret()).update(encoded).digest("base64url");
  }
  return { data, meta: { nextCursor, hasMore } };
}
export function paginate<T extends PagePosition>(items: T[], limit: number, cursor: string | null, filters: unknown) {
  const after = decodePageCursor(cursor, filters);
  const sorted = [...items].sort((a, b) => (b.score || 0) - (a.score || 0) || b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  const rows = after ? sorted.filter(a => (a.score || 0) < (after.score || 0) || ((a.score || 0) === (after.score || 0) && (a.publishedAt < after.publishedAt || a.publishedAt === after.publishedAt && a.id < after.id))) : sorted;
  return finishPage(rows, limit, filters);
}
