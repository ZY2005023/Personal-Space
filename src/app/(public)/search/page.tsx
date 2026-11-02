import { publicPage } from "@/lib/public-data";
import { ContentCard } from "@/components/content-card";
import { PageLinks } from "@/components/page-links";
export const metadata = { title: "搜索" };
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const { q = "", cursor } = await searchParams; const query = q.trim().slice(0, 100);
  const page = query ? await publicPage({ q: query, cursor }) : { data: [], meta: { nextCursor: null, hasMore: false } }; const items = page.data;
  return <main id="main" className="wrap list-page search-page"><div className="eyebrow">SEARCH / 搜索</div><h1>寻找一条记录。</h1><p className="page-intro">从一个词开始，回到某次思考或某个片刻。</p><form className="search-form" action="/search"><label htmlFor="q" className="sr-only">搜索公开内容</label><input id="q" name="q" defaultValue={q} placeholder="搜索标题、正文或标签…" maxLength={100} required /><button className="button primary" type="submit">搜索 ↗</button></form>{query ? <><p className="search-meta">关于「{query}」的公开记录</p>{items.length ? items.map(c => <ContentCard key={c.id} content={c} />) : <div className="empty-state"><h2>没有找到相关记录</h2><p>换一个关键词，再试试看。</p></div>}<PageLinks base="/search" filters={{ q: query }} cursor={cursor} nextCursor={page.meta.nextCursor}/></> : <div className="search-hint">只搜索当前公开的内容。</div>}</main>;
}
