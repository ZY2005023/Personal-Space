"use client";
import Link from "next/link";
import { useState } from "react";
import type { PayloadInput } from "@/lib/domain";
import { apiResponse } from "./admin-client";
import { orderNewAlbumPhotos } from "@/lib/photo-order";
import type { MediaItem } from "./media-manager";
type Placement = PayloadInput["placements"][number];
export function MediaPlacements({ payload, onChange, disabled }: { payload: PayloadInput; onChange: (value: PayloadInput) => void; disabled: boolean }) {
  const [items, setItems] = useState<MediaItem[]>([]), [cursor, setCursor] = useState<string | null>(null), [open, setOpen] = useState(false), [error, setError] = useState(""), [loading, setLoading] = useState(false), [role, setRole] = useState<Placement["role"]>(payload.type === "ALBUM" ? "ALBUM_PHOTO" : "INLINE"), [picked, setPicked] = useState<string[]>([]);
  const [orderAnnouncement, setOrderAnnouncement] = useState("");
  async function load(next = false) {
    setLoading(true); setError("");
    try { const result = await apiResponse<MediaItem[]>("media?status=READY&limit=30" + (next && cursor ? "&cursor=" + encodeURIComponent(cursor) : "")); setItems(previous => next ? [...previous, ...result.data] : result.data); setCursor(result.meta?.nextCursor || null); setOpen(true); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  function placementFor(media: MediaItem, nextRole: Placement["role"]): Placement { return { placementId: crypto.randomUUID(), mediaId: media.id, role: nextRole, caption: "", altText: "" }; }
  function add(media: MediaItem) {
    const placement = placementFor(media, role);
    const placements = [...(role === "COVER" ? payload.placements.filter(p => p.role !== "COVER") : payload.placements), placement];
    const bodyMarkdown = role === "INLINE" ? payload.bodyMarkdown + `\n\n![图片说明](media://${placement.placementId})\n` : payload.bodyMarkdown;
    onChange({ ...payload, placements, bodyMarkdown, coverMediaId: role === "COVER" ? media.id : payload.coverMediaId }); setOpen(false);
  }
  function addSelectedPhotos() {
    const chosen = items.filter(item => picked.includes(item.id));
    if (!chosen.length) return;
    const placements = orderNewAlbumPhotos(chosen).map(item => placementFor(item, "ALBUM_PHOTO"));
    onChange({ ...payload, placements: [...payload.placements, ...placements] }); setPicked([]); setOpen(false);
  }
  function selectRole(nextRole: Placement["role"]) { setRole(nextRole); setPicked([]); }
  function change(id: string, fields: Partial<Placement>) { onChange({ ...payload, placements: payload.placements.map(p => p.placementId === id ? { ...p, ...fields } : p) }); }
  function remove(p: Placement) {
    onChange({ ...payload, placements: payload.placements.filter(other => other.placementId !== p.placementId), coverMediaId: p.role === "COVER" ? null : payload.coverMediaId, bodyMarkdown: payload.bodyMarkdown.replace(new RegExp("!\\[[^\\]]*\\]\\(media://" + p.placementId + "\\)", "g"), "") });
  }
  function move(from: number, to: number) {
    if (from < 0 || to < 0 || to >= payload.placements.length || from === to) return;
    const placements = [...payload.placements];
    const [item] = placements.splice(from, 1);
    placements.splice(to, 0, item);
    const photos = placements.filter(placement => placement.role === "ALBUM_PHOTO");
    const photoIndex = photos.indexOf(item);
    const position = photoIndex >= 0 ? photoIndex + 1 : to + 1;
    const count = photoIndex >= 0 ? photos.length : placements.length;
    setOrderAnnouncement(`已将${item.altText || item.caption || "图片"}移到第 ${position} 位，共 ${count} 张。`);
    onChange({ ...payload, placements });
  }

  return <section className="panel placement-panel"><div className="admin-page-heading"><h3>内容图片</h3><button className="button secondary" disabled={disabled || loading} onClick={() => load()}>从媒体库添加</button></div><p className="small muted">每次使用图片都有独立说明。移除只改变本篇草稿中的引用。</p><p className="sr-only" role="status">{orderAnnouncement}</p>{error && <p role="alert" className="notice error">{error}</p>}
    {open && <div className="media-picker"><div className="admin-actions"><label className="form-field"><span>添加用途</span><select value={role} disabled={disabled} onChange={e => selectRole(e.target.value as Placement["role"])}><option value="COVER">封面</option>{payload.type === "ALBUM" ? <option value="ALBUM_PHOTO">相册照片</option> : <option value="INLINE">正文插图</option>}</select></label><button onClick={() => setOpen(false)}>收起</button><Link href="/admin/media" target="_blank">上传新图片 ↗</Link></div><div className="media-grid">{items.map(item => role === "ALBUM_PHOTO" ? <label key={item.id} className="media-choice"><input type="checkbox" disabled={disabled} checked={picked.includes(item.id)} onChange={e => setPicked(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/><img src={`/api/v1/admin/media/${item.id}/image?variant=THUMBNAIL`} alt="" loading="lazy"/><span>{item.originalFilename}</span></label> : <button key={item.id} className="media-choice" disabled={disabled} onClick={() => add(item)}><img src={`/api/v1/admin/media/${item.id}/image?variant=THUMBNAIL`} alt="" loading="lazy"/><span>{item.originalFilename}</span></button>)}</div>{role === "ALBUM_PHOTO" && <div className="admin-actions"><button className="button primary" disabled={disabled || !picked.length} onClick={addSelectedPhotos}>添加所选 {picked.length} 张</button><span className="small muted">按可信拍摄时间升序，缺失或不可信时按上传顺序追加。</span></div>}{!items.length && <p>还没有处理完成的图片，请先到媒体库上传。</p>}{cursor && <button className="button secondary" disabled={loading} onClick={() => load(true)}>加载更多</button>}</div>}
    {payload.placements.map((p, index) => <article className="placement-row" key={p.placementId} onDragOver={e => { if (!disabled) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (disabled) return; const id = e.dataTransfer.getData("application/x-personal-space-placement"); const from = payload.placements.findIndex(p => p.placementId === id); move(from, index); }}><img src={`/api/v1/admin/media/${p.mediaId}/image?variant=THUMBNAIL`} alt="" loading="lazy" draggable={false}/><div><p className="small">{{ COVER: "封面", INLINE: "正文插图", ALBUM_PHOTO: "相册照片" }[p.role]}</p><label className="form-field"><span>替代文本（描述画面内容）</span><input maxLength={1000} disabled={disabled} value={p.altText} onChange={e => change(p.placementId, { altText: e.target.value })}/></label><label className="form-field"><span>图片说明</span><textarea maxLength={2000} disabled={disabled} value={p.caption} onChange={e => change(p.placementId, { caption: e.target.value })}/></label><div className="admin-actions"><button disabled={disabled} draggable={!disabled} onDragStart={e => { e.dataTransfer.setData("application/x-personal-space-placement", p.placementId); e.dataTransfer.effectAllowed = "move"; }}>拖动排序</button><button disabled={disabled || index === 0} onClick={() => move(index, index - 1)}>上移</button><button disabled={disabled || index === payload.placements.length - 1} onClick={() => move(index, index + 1)}>下移</button><button disabled={disabled} onClick={() => remove(p)}>移除引用</button></div></div></article>)}
  </section>;
}
