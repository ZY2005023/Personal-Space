import Link from "next/link";
import { publicContents } from "@/lib/public-data";
import { ContentCard, Landscape } from "@/components/content-card";
import { previewEnabled } from "@/lib/preview";
export default async function Home() {
  const [items, albums] = await Promise.all([publicContents({ limit: 4 }), publicContents({ type: "ALBUM", limit: 3 })]);
  return <main id="main"><section className="hero wrap"><div className="eyebrow"><span className="small-rule" />一个人的数字花园</div><h1>记录生活，<br className="mobile-break" />也整理所知<span>。</span></h1><p>把日常留下，把知识连接。<br />在这里，慢慢生长。</p><div className="hero-actions"><Link href="/life" className="button primary">走进生活 <span>↗</span></Link><Link href="/knowledge" className="button secondary">浏览知识 <span>↗</span></Link></div><div className="hero-note">生活的切片 / 思考的痕迹 / 值得回访的记录</div></section>
    <section className="wrap latest-section"><div className="section-heading"><div><span className="eyebrow">RECENT NOTES</span><h2>最近，留下的</h2></div><Link href="/life">全部记录 ↗</Link></div><div className="latest-grid">{items.length ? items.slice(0, 4).map(c => <ContentCard key={c.id} content={c} />) : <div className="empty-state"><h3>这里还在慢慢生长</h3><p>新的记录，会出现在这里。</p></div>}</div></section>
    <section className="garden-links wrap"><Link href="/life"><span>01 / LIFE</span><h2>把日常留下</h2><p>片刻、旅行、照片，以及生活里不经意的发现。</p><b aria-hidden>↗</b></Link><Link href="/knowledge"><span>02 / KNOWLEDGE</span><h2>让所知相连</h2><p>阅读、笔记与思考，为下一次回访留一个入口。</p><b aria-hidden>↗</b></Link></section>
    {albums.length > 0 && <section className="wrap photo-section"><div className="section-heading"><div><span className="eyebrow">SELECTED MOMENTS</span><h2>一些眼前的光</h2></div><Link href="/albums">所有相册 ↗</Link></div><div className="photo-grid">{albums.slice(0, 3).map((a, i) => <Link href={a.canonicalPath} key={a.id}>{previewEnabled() ? <Landscape variant={i} /> : a.payload.coverMediaId && a.payload.placements.find(p => p.role === "COVER") ? <img src={`/api/v1/contents/${a.id}/placements/${a.payload.placements.find(p => p.role === "COVER")!.placementId}/image?variant=DISPLAY`} alt={a.payload.title} /> : <div className="album-cover-empty">{a.payload.title}</div>}<h3>{a.payload.title}</h3><p>{a.payload.summary}</p></Link>)}</div></section>}
  </main>;
}
