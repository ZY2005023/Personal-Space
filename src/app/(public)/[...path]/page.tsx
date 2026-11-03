import { notFound, permanentRedirect } from "next/navigation";
import { publicByPath } from "@/lib/public-data";
import { DomainError } from "@/lib/domain";
import { Markdown, headings } from "@/components/markdown";
import { dateLabel } from "@/components/content-card";
import { ReadingProgress } from "@/components/reading";
import { ContentTaxonomy } from "@/components/content-taxonomy";
import { Gallery } from "@/components/gallery";
import { previewEnabled } from "@/lib/preview";
import { cache } from "react";
import type { Metadata } from "next";
import { contentMetadata } from "@/lib/public-metadata";
const readDetail = cache(publicByPath);
type Props = { params: Promise<{ path: string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  try { return contentMetadata((await readDetail("/" + path.join("/"))).content); }
  catch (error) { if (error instanceof DomainError && error.status === 404) return { title: "内容不存在", robots: { index: false, follow: false } }; throw error; }
}
export default async function Detail({ params }: Props) {
  const { path } = await params;
  const result = await readDetail("/" + path.join("/")).catch(e => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const { content: c } = result; if (result.alias) permanentRedirect(c.canonicalPath);
  const p = c.payload, sections = headings(p.bodyMarkdown);
  return <main id="main" className={`wrap reading-page ${p.type === "ALBUM" ? "album-page" : ""}`}><ReadingProgress /><header className="article-header"><div className="eyebrow">{p.module === "LIFE" ? "生活" : "知识"} / {p.type === "ALBUM" ? "相册" : p.type === "MOMENT" ? "日常" : "文章"}</div><h1>{p.title}</h1><p>{dateLabel(c.publishedAt)}{p.type !== "ALBUM" && ` · ${Math.max(1, Math.ceil(p.bodyMarkdown.length / 400))} 分钟阅读`}</p><ContentTaxonomy payload={p}/></header>
    {p.type === "ALBUM" ? <><p className="album-intro">{p.summary}</p><Gallery photos={p.placements.filter(p => p.role === "ALBUM_PHOTO")} title={p.title} preview={previewEnabled()} contentId={c.id} /></> : <div className="reading-layout"><div>{sections.length > 0 && <details className="mobile-toc"><summary>本篇目录</summary>{sections.map(s => <a key={s.id} href={`#${s.id}`}>{s.text}</a>)}</details>}<Markdown body={p.bodyMarkdown} media={{ contentId: c.id, placements: p.placements }} /><div className="article-end">写于日常，留待回访。</div></div>{p.module === "KNOWLEDGE" && sections.length > 0 && <aside className="toc"><b>本篇目录</b>{sections.map(s => <a key={s.id} href={`#${s.id}`} className={s.depth === 3 ? "nested" : ""}>{s.text}</a>)}</aside>}</div>}
  </main>;
}
