import Link from "next/link";
import { ensureAdmin } from "@/lib/admin";
import { auditActionLabel, auditFilters, auditPage } from "@/lib/audit-store";
import { DomainError } from "@/lib/domain";
import { PageLinks } from "@/components/page-links";
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await ensureAdmin(), raw = await searchParams, params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  let filters, page;
  try { filters = auditFilters(params, true); page = await auditPage(admin.user.id, filters); }
  catch (error) { if (error instanceof DomainError && error.status === 400) return <section><h2>查询条件或分页已失效</h2><p>请重新查看审计记录。</p><Link className="button secondary" href="/admin/audit">返回第一页</Link></section>; throw error; }
  return <section><div className="admin-page-heading"><div><div className="eyebrow">ACTIVITY / 审计</div><h2>审计记录</h2><p className="muted">查看内容维护和账号操作的时间与对象。</p></div></div><form className="admin-filters" action="/admin/audit"><div className="form-field"><label htmlFor="audit-action">操作关键词</label><input id="audit-action" name="action" defaultValue={filters.action} maxLength={100} placeholder="如 publish、delete、MFA"/></div><button type="submit" className="button primary">筛选</button><Link className="text-button" href="/admin/audit">清除</Link></form>
    {page.data.length ? <table className="admin-table audit-table"><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>请求标识</th></tr></thead><tbody>{page.data.map(row => <tr key={row.id}><td><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong", hour12: false })}</time></td><td><strong>{auditActionLabel(row.action)}</strong><div className="small muted audit-identifier">{row.action}</div></td><td>{row.targetType}<div className="small muted audit-identifier">{row.targetId || "—"}</div></td><td className="audit-identifier">{row.requestId || "—"}</td></tr>)}</tbody></table> : <div className="empty-state"><h3>{filters.action ? "没有匹配的审计记录" : "还没有审计记录"}</h3><p>后续操作会按发生时间显示在这里。</p></div>}
    <PageLinks base="/admin/audit" filters={filters.action ? { action: filters.action } : {}} cursor={filters.cursor || undefined} nextCursor={page.meta.nextCursor}/></section>;
}
