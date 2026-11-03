"use client";
import { useEffect, useRef, useState } from "react";
import { apiResponse, ApiError } from "./admin-client";
export type TaxonomyRow = { id: string; name: string; slug: string; updatedAt: string; module?: "LIFE" | "KNOWLEDGE"; parentId?: string | null; sortOrder?: number; isSystem?: boolean };
export async function loadCatalog(kind: "categories" | "tags") {
  const rows: TaxonomyRow[] = []; let cursor: string | null = null;
  do { const response: Awaited<ReturnType<typeof apiResponse<TaxonomyRow[]>>> = await apiResponse<TaxonomyRow[]>(kind + "?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")); rows.push(...response.data); cursor = response.meta?.nextCursor || null; } while (cursor);
  return rows;
}
export function TaxonomyManager() {
  const [kind, setKind] = useState<"categories" | "tags">("categories"), [rows, setRows] = useState<TaxonomyRow[]>([]), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ id: string; etag: string } | null>(null), [name, setName] = useState(""), [slug, setSlug] = useState(""), [module, setModule] = useState<"LIFE" | "KNOWLEDGE">("LIFE"), [parentId, setParentId] = useState(""), [sortOrder, setSortOrder] = useState(0);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  async function refresh() { setLoaded(false); try { setRows(await loadCatalog(kind)); setLoaded(true); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { let cancelled = false; setLoaded(false); setRows([]); loadCatalog(kind).then(data => { if (!cancelled) { setRows(data); setLoaded(true); } }).catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, [kind]);
  function reset() { setEditing(null); setName(""); setSlug(""); setParentId(""); setSortOrder(0); retry.current = null; }
  async function edit(row: TaxonomyRow) {
    setBusy(true); setError(""); setMessage("");
    try { const result = await apiResponse<TaxonomyRow>(`${kind}/${row.id}`); if (!result.etag) throw new Error("未取得最新版本，请重试"); const value = result.data; setEditing({ id: value.id, etag: result.etag }); setName(value.name); setSlug(value.slug); setModule(value.module || "LIFE"); setParentId(value.parentId || ""); setSortOrder(value.sortOrder || 0); retry.current = null; }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); setMessage("");
    const body = { name, slug, ...(kind === "categories" ? { module, parentId: parentId || null, sortOrder } : {}) };
    const fingerprint = JSON.stringify({ kind, body, editing });
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
    try { await apiResponse(kind + (editing ? "/" + editing.id : ""), editing ? "PUT" : "POST", body, editing ? { "If-Match": editing.etag } : { "Idempotency-Key": retry.current.key }); reset(); setMessage("已保存。历史快照保留原名称。"); await refresh(); }
    catch (e) { setError((e as Error).message + (e instanceof ApiError && e.status === 412 ? "；输入已保留，请重新读取该条目后核对修改。" : "")); }
    finally { setBusy(false); }
  }
  async function remove(row: TaxonomyRow) {
    if (!confirm(`确认删除“${row.name}”？有引用或子分类时会阻止删除。名称和地址仍会保留。`)) return;
    setBusy(true); setError(""); setMessage("");
    try { const latest = await apiResponse<TaxonomyRow>(`${kind}/${row.id}`); if (!latest.etag) throw new Error("未取得最新版本"); if (latest.data.updatedAt !== row.updatedAt) throw new Error("此条目已更新，请刷新并检查后再删除"); await apiResponse(`${kind}/${row.id}`, "DELETE", undefined, { "If-Match": latest.etag, "Idempotency-Key": crypto.randomUUID() }); if (editing?.id === row.id) reset(); setMessage("已删除，名称和地址仍保留。"); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const sorted = [...rows].sort((a, b) => (a.module || "").localeCompare(b.module || "") || (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
  return <section><div className="admin-page-heading"><div><h2>分类与标签</h2><p className="muted">分类最多两级，标签全站共享。删除前会检查草稿、历史与发布引用。</p></div><div className="admin-actions">{(["categories", "tags"] as const).map(k => <button key={k} className={kind === k ? "button primary" : "button secondary"} disabled={busy || !!editing} onClick={() => { setKind(k); reset(); setError(""); setMessage(""); }}>{k === "categories" ? "模块分类" : "全站标签"}</button>)}</div></div>
    {error && <p className="notice warning" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <form className="panel taxonomy-form" onSubmit={submit}><h3>{editing ? "编辑" : "新建"}{kind === "categories" ? "分类" : "标签"}</h3><fieldset disabled={busy || !loaded}><label className="form-field"><span>名称</span><input required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label><label className="form-field"><span>地址标识（小写英文、数字及连字符）</span><input required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e => setSlug(e.target.value)}/></label>{kind === "categories" && <><label className="form-field"><span>所属模块</span><select value={module} onChange={e => { setModule(e.target.value as typeof module); setParentId(""); }}><option value="LIFE">生活</option><option value="KNOWLEDGE">知识</option></select></label><label className="form-field"><span>上级分类</span><select value={parentId} onChange={e => setParentId(e.target.value)}><option value="">无（一级分类）</option>{rows.filter(r => r.module === module && !r.parentId && r.id !== editing?.id).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className="form-field"><span>排序（数值越小越靠前）</span><input type="number" min={0} max={2147483647} required value={sortOrder} onChange={e => setSortOrder(e.target.valueAsNumber)}/></label></>}<div className="admin-actions"><button className="button primary" type="submit">{busy ? "正在保存…" : "保存"}</button>{editing && <button type="button" className="button secondary" onClick={reset}>取消编辑</button>}</div></fieldset></form>
    <table className="admin-table"><caption className="sr-only">{kind === "categories" ? "分类列表" : "标签列表"}</caption><thead><tr><th>名称</th><th>地址标识</th><th>所属位置</th><th>操作</th></tr></thead><tbody>{sorted.map(row => <tr key={row.id}><td>{row.name}{row.isSystem ? " · 系统" : ""}</td><td>{row.slug}</td><td>{row.module ? (row.module === "LIFE" ? "生活" : "知识") + (row.parentId ? " / " + (rows.find(r => r.id === row.parentId)?.name || "上级分类") : " / 一级") : "全站"}</td><td><div className="admin-actions"><button disabled={busy || row.isSystem} onClick={() => edit(row)}>编辑</button><button disabled={busy || row.isSystem} onClick={() => remove(row)}>删除</button></div></td></tr>)}</tbody></table>{loaded && !rows.length && <p className="muted">尚无条目，可以在上方新建。</p>}
  </section>;
}
