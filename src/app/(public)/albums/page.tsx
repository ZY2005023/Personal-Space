import Link from "next/link";
import { publicPage } from "@/lib/public-data";
import { Landscape } from "@/components/content-card";
import { PageLinks } from "@/components/page-links";
import { previewEnabled } from "@/lib/preview";
import { DomainError } from "@/lib/domain";
import { browseFilters, browseHref, browseValues, type BrowseParams } from "@/lib/browse";
import { BrowseFilters } from "@/components/browse-filters";
import { BrowseFeedback } from "@/components/browse-feedback";
export const metadata = { title: "相册" };
export default async function Albums({ searchParams }: { searchParams: Promise<BrowseParams> }) {
  let filters, page;
  try { filters = browseFilters(await searchParams, { module: "LIFE", type: "ALBUM" }); }
  catch (error) { if (error instanceof DomainError && error.status === 400) return <BrowseFeedback base="/albums" />; throw error; }
  try { page = await publicPage(filters); }
  catch (error) { if (error instanceof DomainError && error.status === 400) return <BrowseFeedback base={browseHref("/albums", filters)} cursor />; throw error; }
  const cursor = filters.cursor || undefined, albums = page.data;
 return <main id="main" className="wrap list-page"><div className="eyebrow">ALBUMS / 相册</div><h1>一些眼前的光。</h1><p className="page-intro">收藏一些眼前的光，也收藏当时的心情。</p><BrowseFilters base="/albums" filters={filters} fixedType /><div className="album-grid">{albums.map((c, i) => <Link key={c.id} href={c.canonicalPath}>{previewEnabled() ? <Landscape variant={i} /> : c.payload.placements.find(p => p.role === "COVER") ? <img className="album-cover-image" src={`/api/v1/contents/${c.id}/placements/${c.payload.placements.find(p => p.role === "COVER")!.placementId}/image?variant=DISPLAY`} alt={c.payload.placements.find(p => p.role === "COVER")!.altText} loading="lazy"/> : <div className="album-cover-empty">{c.payload.title}</div>}<h2>{c.payload.title}</h2><p>{c.payload.placements.filter(p => p.role === "ALBUM_PHOTO").length} 张照片 · 生活</p></Link>)}</div>{!albums.length && <div className="empty-state"><h2>{filters.categoryId || filters.tagId ? "没有符合筛选条件的相册" : "相册还在整理中"}</h2><p>{filters.categoryId || filters.tagId ? "试试其他分类或标签。" : "值得留下的光，会被慢慢收集。"}</p></div>}<PageLinks base="/albums" filters={browseValues(filters)} cursor={cursor} nextCursor={page.meta.nextCursor}/></main>; }
