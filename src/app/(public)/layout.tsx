import { Nav, Footer } from "@/components/nav";
import { previewEnabled } from "@/lib/preview";
import type { Metadata } from "next";
import { publicSiteProfile } from "@/lib/settings-store";
import { siteMetadata } from "@/lib/public-metadata";
export async function generateMetadata(): Promise<Metadata> { return siteMetadata(await publicSiteProfile()); }
export const dynamic = "force-dynamic";
export default async function PublicLayout({ children }: { children: React.ReactNode }) { const site = await publicSiteProfile(); return <><Nav siteTitle={site.siteTitle}/>{previewEnabled() && <div className="preview-banner">只读设计预览 · 示例文字与插图均非正式发布内容</div>}{children}<Footer siteTitle={site.siteTitle} siteIntro={site.siteIntro}/></>; }
