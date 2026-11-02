import Link from "next/link";
export function PageLinks({ base, filters = {}, cursor, nextCursor }: { base: string; filters?: Record<string, string>; cursor?: string; nextCursor: string | null }) {
  const href = (next?: string) => { const params = new URLSearchParams(filters); if (next) params.set("cursor", next); return base + (params.size ? "?" + params.toString() : ""); };
  if (!cursor && !nextCursor) return null;
  return <nav className="admin-actions" aria-label="分页" style={{ marginTop: 32 }}>{cursor && <Link className="button secondary" href={href()}>返回第一页</Link>}{nextCursor && <Link className="button secondary" href={href(nextCursor)}>下一页 →</Link>}</nav>;
}
