import Link from "next/link";
import type { PublicContent } from "@/lib/public-data";
export const typeLabel = { ARTICLE: "文章", MOMENT: "生活记录", ALBUM: "相册" };
export function dateLabel(value: string) { return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).replaceAll("/", "."); }
export function Landscape({ variant = 0 }: { variant?: number }) { return <div className={`landscape landscape-${variant % 3}`} role="img" aria-label="矢量山景设计样片"><svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" aria-hidden><path d="M0 305 160 130 320 310 480 185 600 270V400H0Z" fill="currentColor" opacity=".5"/><path d="m0 350 300-90 300 95v45H0Z" fill="currentColor"/></svg><span>设计样片 · 山与日常</span></div>; }
export function ContentCard({ content }: { content: PublicContent }) {
  const p = content.payload;
  return <article className="content-card"><div className="content-eyebrow">{p.module === "LIFE" ? "生活" : "知识"}<span> / </span>{typeLabel[p.type]}</div><Link href={content.canonicalPath} className="content-title">{p.title}<span aria-hidden>↗</span></Link><p>{p.summary}</p><div className="content-date">{dateLabel(content.publishedAt)}<span> · </span>{Math.max(1, Math.ceil(p.bodyMarkdown.length / 400))} 分钟阅读</div></article>;
}
