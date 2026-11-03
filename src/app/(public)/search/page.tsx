import { publicPage } from "@/lib/public-data";
import { ContentCard } from "@/components/content-card";
import { PageLinks } from "@/components/page-links";
import { DomainError } from "@/lib/domain";
import { browseFilters, browseHref, browseValues, type BrowseParams } from "@/lib/browse";
import { BrowseFilters } from "@/components/browse-filters";
import { BrowseFeedback } from "@/components/browse-feedback";
export const metadata = { title: "搜索" };
export default async function Search({ searchParams }: { searchParams: Promise<BrowseParams> }) {
  let filters, page;
  try { filters = browseFilters(await searchParams, { search: true }); }
  catch (error) { if (error instanceof DomainError && error.status === 400) return <BrowseFeedback base="/search" />; throw error; }
  const query = filters.q || "", cursor = filters.cursor || undefined;
  try { page = query ? await publicPage(filters) : { data: [], meta: { nextCursor: null, hasMore: false } }; }
  catch (error) { if (error instanceof DomainError && error.status === 400) return <BrowseFeedback base={browseHref("/search", filters)} cursor />; throw error; }
  const items = page.data;
  return <main id="main" className="wrap list-page search-page"><div className="eyebrow">SEARCH / 搜索</div><h1>寻找一条记录。</h1><p className="page-intro">从一个词开始，回到某次思考或某个片刻。</p><BrowseFilters base="/search" filters={filters} search />{query ? <><p className="search-meta">关于「{query}」的公开记录</p>{items.length ? items.map(c => <ContentCard key={c.id} content={c} />) : <div className="empty-state"><h2>没有找到相关记录</h2><p>换一个关键词，再试试看。</p></div>}<PageLinks base="/search" filters={browseValues(filters)} cursor={cursor} nextCursor={page.meta.nextCursor}/></> : <div className="search-hint">只搜索当前公开的内容。</div>}</main>;
}
