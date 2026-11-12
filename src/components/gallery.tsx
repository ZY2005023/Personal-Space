"use client";
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { Landscape } from "./content-card";
type Photo = { placementId: string; caption: string; altText: string };
export function Gallery({ photos, title, preview, contentId }: { photos: Photo[]; title: string; preview: boolean; contentId: string }) {
  const [selected, setSelected] = useState<number | null>(null); const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (selected === null) { dialog.current?.close(); trigger.current?.focus(); } else if (!dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const move = (delta: number) => setSelected(i => i === null ? null : (i + delta + photos.length) % photos.length);
  function startSwipe(event: TouchEvent<HTMLDivElement>) {
    const point = event.touches.item(0);
    touchStart.current = event.touches.length === 1 && point ? { x: point.clientX, y: point.clientY } : null;
  }

  function finishSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    const point = event.changedTouches.item(0);
    if (!start || !point || event.touches.length || photos.length < 2) return;
    const horizontal = point.clientX - start.x;
    const vertical = point.clientY - start.y;
    if (Math.abs(horizontal) >= 48 && Math.abs(horizontal) > Math.abs(vertical)) move(horizontal < 0 ? 1 : -1);
  }
  return <><div className="album-masonry">{photos.map((p, i) => <figure key={p.placementId}><button className="image-button" onClick={e => { trigger.current = e.currentTarget; setSelected(i); }} aria-label={`查看第 ${i + 1} 张图片：${p.altText}`}>
    {preview ? <Landscape variant={i} /> : <img src={`/api/v1/contents/${contentId}/placements/${p.placementId}/image?variant=DISPLAY`} alt={p.altText} loading="lazy" />}</button><figcaption>{String(i + 1).padStart(2, "0")} / {p.caption}</figcaption></figure>)}</div>
    <dialog ref={dialog} className="lightbox" aria-label={`${title} 图片浏览`} onCancel={e => { e.preventDefault(); setSelected(null); }} onKeyDown={e => { if (e.key === "ArrowRight") move(1); if (e.key === "ArrowLeft") move(-1); }}><div className="lightbox-top"><span aria-live="polite">{title} · {selected === null ? 0 : selected + 1} / {photos.length}</span><button onClick={() => setSelected(null)}>关闭 ×</button></div>{selected !== null && <div className="lightbox-image" onTouchStart={startSwipe} onTouchEnd={finishSwipe} onTouchCancel={() => { touchStart.current = null; }}>{preview ? <Landscape variant={selected} /> : <img src={`/api/v1/contents/${contentId}/placements/${photos[selected].placementId}/image?variant=DISPLAY`} alt={photos[selected].altText} />}<p>{photos[selected].caption}</p></div>}<div className="lightbox-controls"><button onClick={() => move(-1)}>← 上一张</button><button onClick={() => move(1)}>下一张 →</button></div></dialog></>;
}
