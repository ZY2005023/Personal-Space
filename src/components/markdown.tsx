import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PayloadInput } from "@/lib/domain";
export function headingId(text: string) { return "section-" + text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-"); }
export function headings(body: string) {
  let fenced = false; const used = new Map<string, number>();
  return body.split("\n").flatMap(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return []; }
    const m = fenced ? null : /^(#{2,3})\s+(.+)$/.exec(line); if (!m) return [];
    const base = headingId(m[2]), n = used.get(base) || 0; used.set(base, n + 1);
    return [{ text: m[2], id: base + (n ? `-${n}` : ""), depth: m[1].length }];
  });
}
export function Markdown({ body, media }: { body: string; media?: { contentId?: string; admin?: boolean; placements: PayloadInput["placements"] } }) {
  let index = 0; const sections = headings(body);
  const urls = new Map((media?.placements || []).filter(p => p.role === "INLINE").map(p => ["media://" + p.placementId, { p, url: media?.admin ? `/api/v1/admin/media/${p.mediaId}/image?variant=DISPLAY` : media?.contentId ? `/api/v1/contents/${media.contentId}/placements/${p.placementId}/image?variant=DISPLAY` : "" }]));
  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url, key, node) => node.tagName === "img" && key === "src" ? urls.get(url)?.url || "" : defaultUrlTransform(url)} components={{
    h2: ({ children }) => <h2 id={sections[index++]?.id}>{children}</h2>,
    h3: ({ children }) => <h3 id={sections[index++]?.id}>{children}</h3>,
    img: ({ src, alt }) => { const resolved = [...urls.values()].find(v => v.url && v.url === src); return resolved ? <img src={resolved.url} alt={resolved.p.altText || alt || ""} loading="lazy"/> : <span className="media-pending">{alt || "图片"} · 图片引用不可用</span>; },
    a: ({ href, children }) => <a href={href} rel="noopener noreferrer">{children}</a>,
  }}>{body}</ReactMarkdown></div>;
}
