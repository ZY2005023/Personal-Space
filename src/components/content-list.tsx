import Link from "next/link";
import { ContentCard } from "./content-card";
import { publicPage } from "@/lib/public-data";
import { PageLinks } from "./page-links";
import { notFound } from "next/navigation";
import type { State } from "@/lib/domain";
export async function ContentList({ module, searchParams }: { module: "LIFE" | "KNOWLEDGE"; searchParams: Promise<{ type?: string; cursor?: string }> }) {
  const query = await searchParams;
  if (query.type && !["ARTICLE", "MOMENT", "ALBUM"].includes(query.type)) notFound();
  const page = await publicPage({ module, type: query.type as State["type"] || undefined, cursor: query.cursor });
  const items = page.data;
  const base = module === "LIFE" ? "/life" : "/knowledge";
  return <main id="main" className="wrap list-page"><div className="eyebrow">{module === "LIFE" ? "LIFE / 生活" : "KNOWLEDGE / 知识"}</div><h1>{module === "LIFE" ? "把日常，慢慢留下。" : "把所知，慢慢连接。"}</h1><p className="page-intro">{module === "LIFE" ? "日常、片刻与照片。收藏生活里不经意的发现。" : "阅读与思考的痕迹，整理成可回访的路径。"}</p><nav className="filters" aria-label="内容类型">{[["", "全部"], ["ARTICLE", "文章"], ...(module === "LIFE" ? [["MOMENT", "记录"], ["ALBUM", "相册"]] : [])].map(([v, t]) => <Link key={v} href={base + (v ? `?type=${v}` : "")} className={(query.type || "") === v ? "active" : ""}>{t}</Link>)}</nav><div className="list-content">{items.length ? items.map(c => <ContentCard key={c.id} content={c} />) : <div className="empty-state"><h2>这里还没有记录</h2><p>留下的第一条记录，会出现在这里。</p></div>}</div><PageLinks base={base} filters={query.type ? { type: query.type } : {}} cursor={query.cursor} nextCursor={page.meta.nextCursor}/></main>;
}
