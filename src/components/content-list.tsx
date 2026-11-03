import Link from "next/link";
import { ContentCard } from "./content-card";
import { publicPage } from "@/lib/public-data";
import { PageLinks } from "./page-links";
import { DomainError } from "@/lib/domain";
import { browseFilters, browseHref, browseValues, type BrowseParams } from "@/lib/browse";
import { BrowseFilters } from "./browse-filters";
import { BrowseFeedback } from "./browse-feedback";

export async function ContentList({ module, searchParams }: { module: "LIFE" | "KNOWLEDGE"; searchParams: Promise<BrowseParams> }) {
  const base = module === "LIFE" ? "/life" : "/knowledge";
  let query, page;
  try { query = browseFilters(await searchParams, { module }); }
  catch (error) { if (error instanceof DomainError && error.status === 400) return <BrowseFeedback base={base} />; throw error; }
  try { page = await publicPage(query); }
  catch (error) { if (error instanceof DomainError && error.status === 400) return <BrowseFeedback base={browseHref(base, query)} cursor />; throw error; }
  const items = page.data;
  return <main id="main" className="wrap list-page"><div className="eyebrow">{module === "LIFE" ? "LIFE / 生活" : "KNOWLEDGE / 知识"}</div><h1>{module === "LIFE" ? "把日常，慢慢留下。" : "把所知，慢慢连接。"}</h1><p className="page-intro">{module === "LIFE" ? "日常、片刻与照片。收藏生活里不经意的发现。" : "阅读与思考的痕迹，整理成可回访的路径。"}</p><nav className="filters" aria-label="内容类型">{[["", "全部"], ["ARTICLE", "文章"], ...(module === "LIFE" ? [["MOMENT", "记录"], ["ALBUM", "相册"]] : [])].map(([v, t]) => <Link key={v} href={browseHref(base, query, { type: v as typeof query.type || undefined })} aria-current={(query.type || "") === v ? "page" : undefined} className={(query.type || "") === v ? "active" : ""}>{t}</Link>)}</nav><BrowseFilters base={base} filters={query}/><div className="list-content">{items.length ? items.map(c => <ContentCard key={c.id} content={c} />) : <div className="empty-state"><h2>{query.categoryId || query.tagId || query.type ? "没有符合筛选条件的记录" : "这里还没有记录"}</h2><p>{query.categoryId || query.tagId || query.type ? "试试其他分类、标签或内容类型。" : "留下的第一条记录，会出现在这里。"}</p></div>}</div><PageLinks base={base} filters={browseValues(query)} cursor={query.cursor || undefined} nextCursor={page.meta.nextCursor}/></main>;
}
