import Link from "next/link";
import { publicPage } from "@/lib/public-data";
import { Landscape } from "@/components/content-card";
import { PageLinks } from "@/components/page-links";
import { previewEnabled } from "@/lib/preview";
export const metadata = { title: "相册" };
export default async function Albums({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) { const { cursor } = await searchParams; const page = await publicPage({ type: "ALBUM", cursor }); const albums = page.data; return <main id="main" className="wrap list-page"><div className="eyebrow">ALBUMS / 相册</div><h1>一些眼前的光。</h1><p className="page-intro">收藏一些眼前的光，也收藏当时的心情。</p><div className="album-grid">{albums.map((c, i) => <Link key={c.id} href={c.canonicalPath}>{previewEnabled() ? <Landscape variant={i} /> : <div className="album-cover-empty">{c.payload.title}</div>}<h2>{c.payload.title}</h2><p>{c.payload.placements.filter(p => p.role === "ALBUM_PHOTO").length} 张照片 · 生活</p></Link>)}</div>{!albums.length && <div className="empty-state"><h2>相册还在整理中</h2><p>值得留下的光，会被慢慢收集。</p></div>}<PageLinks base="/albums" cursor={cursor} nextCursor={page.meta.nextCursor}/></main>; }
