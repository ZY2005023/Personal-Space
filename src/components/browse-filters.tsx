import Link from "next/link";
import { publicTaxonomy } from "@/lib/public-data";
import type { PublicFilters } from "@/lib/public-store";
import { CatalogSelect, type CatalogPage } from "./catalog-select";
import { SearchScope } from "./search-scope";
const empty: CatalogPage = { data: [], meta: { nextCursor: null, hasMore: false } };
export async function BrowseFilters({ base, filters, search = false, fixedType = false }: { base: string; filters: PublicFilters; search?: boolean; fixedType?: boolean }) {
  const [categories, tags] = await Promise.allSettled([publicTaxonomy("categories"), publicTaxonomy("tags")]);
  return <form action={base} className="browse-filters" aria-label="筛选公开内容">
    {search && <div className="form-field browse-query"><label htmlFor="browse-q">搜索公开内容</label><input id="browse-q" name="q" defaultValue={filters.q} placeholder="搜索标题、正文或标签…" maxLength={100} required /></div>}
    {search ? <SearchScope key={`${filters.module || ""}:${filters.type || ""}`} initialModule={filters.module} initialType={filters.type}/> : filters.type && !fixedType ? <input type="hidden" name="type" value={filters.type} /> : null}
    <CatalogSelect key={`categories:${filters.module || ""}:${filters.categoryId || ""}`} kind="categories" initial={categories.status === "fulfilled" ? categories.value as CatalogPage : empty} selected={filters.categoryId} module={search ? undefined : filters.module} failed={categories.status === "rejected"} />
    <CatalogSelect key={`tags:${filters.tagId || ""}`} kind="tags" initial={tags.status === "fulfilled" ? tags.value as CatalogPage : empty} selected={filters.tagId} failed={tags.status === "rejected"} />
    <div className="browse-filter-actions"><button className="button primary" type="submit">{search ? "搜索" : "应用筛选"}</button><Link className="text-button" href={base}>清除筛选</Link></div>
  </form>;
}
