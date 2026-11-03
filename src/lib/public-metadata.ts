import type { Metadata } from "next";
import type { PublicContent } from "./public-store";
import type { SiteProfile } from "./site-settings";
export function siteMetadata(site: SiteProfile): Metadata {
  return { title: { default: `${site.siteTitle} · 记录生活，也整理所知`, template: `%s · ${site.siteTitle}` }, description: site.siteIntro };
}
export function contentMetadata(content: PublicContent): Metadata {
  const fallback = content.payload.type === "ALBUM" ? "相册" : content.payload.type === "MOMENT" ? "生活记录" : "文章";
  return { title: content.payload.title || fallback, description: content.payload.summary.replace(/\s+/g, " ").trim().slice(0, 160) };
}
