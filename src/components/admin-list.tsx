"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { viewAdmin } from "@/lib/domain";
import type { AdminFilters, AdminPage, AdminSummary } from "@/lib/admin-read-store";
import { dateLabel, typeLabel } from "./content-card";
import { api, ApiError } from "./admin-client";
import { loadCatalog, type TaxonomyRow } from "./taxonomy-manager";
export function AdminList({ initial, filters, trash = false }: { initial: AdminPage; filters: AdminFilters; trash?: boolean }) {
  const router = useRouter(); const [filter, setFilter] = useState(filters.q), [filterType, setFilterType] = useState(filters.type || ""), [filterModule, setFilterModule] = useState(filters.module || ""), [filterCategory, setFilterCategory] = useState(filters.categoryId || ""), [filterTag, setFilterTag] = useState(filters.tagId || "");
  const [categories, setCategories] = useState<TaxonomyRow[]>([]), [tags, setTags] = useState<TaxonomyRow[]>([]);
  useEffect(() => { let cancelled = false; Promise.allSettled([loadCatalog("categories"), loadCatalog("tags")]).then(([c, t]) => { if (cancelled) return; if (c.status === "fulfilled") setCategories(c.value); if (t.status === "fulfilled") setTags(t.value); }); return () => { cancelled = true; }; }, []);
  const [type, setType] = useState("ARTICLE"), [module, setModule] = useState("KNOWLEDGE"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [filtering, startTransition] = useTransition();
  const pendingCreate = useRef<{ signature: string; key: string } | null>(null), restoreKeys = useRef(new Map<string, string>());
  const base = trash ? "/admin/trash" : "/admin/contents";
  function url(cursor?: string | null) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: filters.q, type: filters.type, module: filters.module, categoryId: filters.categoryId, tagId: filters.tagId, limit: String(filters.limit), cursor })) if (value) params.set(key, value);
    return base + (params.size ? "?" + params.toString() : "");
  }
  function search(event: React.FormEvent) {
    event.preventDefault(); const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: filter.trim(), type: filterType, module: filterModule, categoryId: filterCategory, tagId: filterTag, limit: String(filters.limit) })) if (value) params.set(key, value);
    startTransition(() => router.push(base + "?" + params));
  }
  async function create() {
    setBusy(true); setError(""); const body = { type, module: type === "ARTICLE" ? module : "LIFE" }; const signature = JSON.stringify(body);
    if (pendingCreate.current?.signature !== signature) pendingCreate.current = { signature, key: crypto.randomUUID() };
    try { const result = await api<ReturnType<typeof viewAdmin>>("contents", "POST", body, { "Idempotency-Key": pendingCreate.current.key }); pendingCreate.current = null; router.push(`/admin/contents/${result.state.id}`); }
    catch (e) { if (e instanceof ApiError && e.status < 500) pendingCreate.current = null; setError((e as Error).message); } finally { setBusy(false); }
  }
  async function restore(item: AdminSummary) {
    if (!confirm("恢复后将保持私密，且不会自动重新发布。确认恢复？")) return; setBusy(true); setError("");
    const fingerprint = item.state.id + item.state.stateEtag; const key = restoreKeys.current.get(fingerprint) || crypto.randomUUID(); restoreKeys.current.set(fingerprint, key);
    try { await api(`contents/${item.state.id}/restore`, "POST", undefined, { "If-Match": item.state.stateEtag, "Idempotency-Key": key }); restoreKeys.current.delete(fingerprint); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const disabled = busy || filtering, filtered = !!(filters.q || filters.module || filters.type || filters.categoryId || filters.tagId);
  return <><div className="admin-page-heading"><div><h2>{trash ? "回收站" : "内容管理"}</h2><p className="muted small">{trash ? "恢复后默认私密，需要重新确认发布。" : "草稿与线上版本分开保存，列表按最近编辑或状态变动排序。"}</p></div></div>
    {!trash && <div className="admin-actions"><label className="form-field"><span>新建内容类型</span><select disabled={disabled} value={type} onChange={e => setType(e.target.value)}><option value="ARTICLE">文章</option><option value="MOMENT">生活记录</option><option value="ALBUM">相册</option></select></label>{type === "ARTICLE" && <label className="form-field"><span>新建所属模块</span><select disabled={disabled} value={module} onChange={e => setModule(e.target.value)}><option value="KNOWLEDGE">知识</option><option value="LIFE">生活</option></select></label>}<button style={{ alignSelf: "end", marginBottom: 22 }} className="button primary" onClick={create} disabled={disabled}>新建内容 ＋</button></div>}
    <form className="admin-filters" onSubmit={search}><label className="form-field"><span>查找草稿标题</span><input disabled={disabled} maxLength={100} value={filter} onChange={e => setFilter(e.target.value)} placeholder="输入标题关键词…"/></label><label className="form-field"><span>筛选类型</span><select value={filterType} disabled={disabled} onChange={e => setFilterType(e.target.value as typeof filterType)}><option value="">全部类型</option>{Object.entries(typeLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="form-field"><span>筛选模块</span><select value={filterModule} disabled={disabled} onChange={e => { setFilterModule(e.target.value as typeof filterModule); setFilterCategory(""); }}><option value="">全部模块</option><option value="LIFE">生活</option><option value="KNOWLEDGE">知识</option></select></label><label className="form-field"><span>筛选分类</span><select value={filterCategory} disabled={disabled} onChange={e => setFilterCategory(e.target.value)}><option value="">全部分类</option>{categories.filter(item => !filterModule || item.module === filterModule).map(item => <option key={item.id} value={item.id}>{item.parentId ? "— " : ""}{item.name}</option>)}</select></label><label className="form-field"><span>筛选标签</span><select value={filterTag} disabled={disabled} onChange={e => setFilterTag(e.target.value)}><option value="">全部标签</option>{tags.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button secondary" disabled={disabled}>筛选</button><Link className="text-button" href={base}>清除筛选</Link></form>
    {error && <p className="notice error" role="alert">{error}</p>}{filtering && <p role="status">正在读取列表…</p>}
    <table className="admin-table" aria-busy={filtering}><caption className="sr-only">{trash ? "已删除内容" : "内容摘要"}</caption><thead><tr><th>标题</th><th>状态</th><th>类型</th><th>状态更新时间</th><th>操作</th></tr></thead><tbody>{initial.data.map(item => <tr key={item.state.id}><td>{item.draftTitle || "未命名草稿"}</td><td><span className={`badge ${item.state.effectiveVisibility === "PRIVATE" ? "private" : ""}`}>{item.state.publicationState === "NEVER_PUBLISHED" ? "草稿" : item.state.publicationState === "UNPUBLISHED" ? "已撤回" : item.state.effectiveVisibility === "PRIVATE" ? "私密" : "公开"}</span></td><td>{typeLabel[item.state.type]}</td><td className="hide-mobile">{dateLabel(item.state.updatedAt)}</td><td>{trash ? <button className="text-button" disabled={disabled} onClick={() => restore(item)}>恢复为私密</button> : <Link className="text-button" href={`/admin/contents/${item.state.id}`}>编辑 →</Link>}</td></tr>)}</tbody></table>
    {!initial.data.length && <div className="empty-state"><h3>{filters.cursor ? "这一页已无内容" : filtered ? "没有匹配的内容" : trash ? "回收站是空的" : "还没有记录"}</h3><p>{filtered ? "可以调整关键词或清除筛选。" : "新增或恢复后的内容会在相应列表中显示。"}</p></div>}
    <nav className="admin-actions" aria-label="后台列表分页" style={{ marginTop: 24 }}>{filters.cursor && <Link className="button secondary" href={url()}>返回第一页</Link>}{initial.meta.nextCursor && <Link className="button secondary" href={url(initial.meta.nextCursor)}>下一页 →</Link>}<span className="small muted">本页 {initial.data.length} 条{initial.meta.hasMore ? "，还有更多内容" : ""}</span></nav>
  </>;
}
