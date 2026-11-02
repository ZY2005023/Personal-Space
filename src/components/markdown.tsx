import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
export function Markdown({ body }: { body: string }) {
  let index = 0; const sections = headings(body);
  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    h2: ({ children }) => <h2 id={sections[index++]?.id}>{children}</h2>,
    h3: ({ children }) => <h3 id={sections[index++]?.id}>{children}</h3>,
    img: ({ alt }) => <span className="media-pending">{alt || "图片"} · 媒体展示尚未接入</span>,
    a: ({ href, children }) => <a href={href} rel="noopener noreferrer">{children}</a>,
  }}>{body}</ReactMarkdown></div>;
}
