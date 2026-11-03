"use client";
import { useEffect, useRef, useState } from "react";
import { appendCatalogPage, type CatalogPage } from "@/lib/catalog-page";
export type { CatalogPage } from "@/lib/catalog-page";
export function CatalogSelect({ kind, initial, selected = "", module, failed = false }: { kind: "categories" | "tags"; initial: CatalogPage; selected?: string; module?: string; failed?: boolean }) {
  const [page, setPage] = useState(initial), [error, setError] = useState(failed), [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const label = kind === "categories" ? "分类" : "标签", name = kind === "categories" ? "categoryId" : "tagId";
  const options = page.data.filter(item => !module || !item.module || item.module === module);
  async function more() {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(false);
    try {
      const query = new URLSearchParams({ limit: "20" }); if (page.meta.nextCursor) query.set("cursor", page.meta.nextCursor);
      const response = await fetch(`/api/v1/${kind}?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), cache: "no-store" });
      if (!response.ok) throw new Error();
      const value: unknown = await response.json();
      setPage(appendCatalogPage(page, value));
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); active.current = null; }
  }
  return <div className="form-field catalog-field"><label htmlFor={`browse-${kind}`}>{label}</label><select id={`browse-${kind}`} name={name} defaultValue={selected}><option value="">全部{label}</option>{selected && !options.some(item => item.id === selected) && <option value={selected}>已选{label}</option>}{options.map(item => <option key={item.id} value={item.id}>{item.parentId ? "— " : ""}{item.name}</option>)}</select>{(page.meta.hasMore || error) && <button type="button" className="text-button catalog-more" disabled={busy} onClick={more}>{busy ? "加载中…" : error ? `重试加载${label}` : `加载更多${label}`}</button>}<span className="small" role="status" aria-live="polite">{error ? `${label}暂时无法加载，已选条件仍可使用。` : busy ? `正在加载${label}` : ""}</span></div>;
}
