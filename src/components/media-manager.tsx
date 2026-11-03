"use client";
import { useEffect, useRef, useState } from "react";
import { apiResponse } from "./admin-client";
export type MediaItem = { id: string; originalFilename: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; capturedAt: string | null; captureTimeTrusted: boolean; uploadedAt: string; processingStatus: "UPLOADING" | "PROCESSING" | "READY" | "FAILED" };
export function MediaManager() {
  const [items, setItems] = useState<MediaItem[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null), [jobId, setJobId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), pending = useRef<string | null>(null);
  const deleteRetries = useRef(new Map<string, string>());
  async function load(next = false) {
    const result = await apiResponse<MediaItem[]>("media?limit=30" + (next && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    setItems(previous => next ? [...previous, ...result.data.filter(m => !previous.some(p => p.id === m.id))] : result.data); setCursor(result.meta?.nextCursor || null); setLoaded(true);
  }
  useEffect(() => { let cancelled = false; apiResponse<MediaItem[]>("media?limit=30").then(r => { if (!cancelled) { setItems(r.data); setCursor(r.meta?.nextCursor || null); setLoaded(true); } }).catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  useEffect(() => {
    if (!items.some(m => ["UPLOADING", "PROCESSING"].includes(m.processingStatus)) && !jobId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const updates = await Promise.all(items.filter(m => ["UPLOADING", "PROCESSING"].includes(m.processingStatus)).map(m => apiResponse<MediaItem>("media/" + m.id)));
        if (!cancelled) setItems(previous => previous.map(m => updates.find(u => u.data.id === m.id)?.data || m));
        if (jobId) { const job = await apiResponse<{ status: string; errorCode: string | null }>("jobs/" + jobId); if (!cancelled && ["SUCCEEDED", "FAILED"].includes(job.data.status)) { setJobId(null); setMessage(job.data.status === "SUCCEEDED" ? "图片处理完成，可以用于发布。" : "图片处理失败，请检查原图后重新上传。"); } }
      } catch (e) { if (!cancelled) { setError((e as Error).message); setJobId(null); } }
    }, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [items, jobId]);
  async function upload(event: React.FormEvent) {
    event.preventDefault(); if (!file || busy) return; setBusy(true); setError(""); setMessage("");
    pending.current ||= crypto.randomUUID(); const form = new FormData(); form.append("file", file);
    try { const result = await apiResponse<{ media: MediaItem; job: { id: string } }>("media", "POST", form, { "Idempotency-Key": pending.current }); setJobId(result.data.job.id); pending.current = null; setFile(null); if (input.current) input.current.value = ""; setMessage("原图已接收，正在等待后台处理。"); await load(); }
    catch (e) { setError((e as Error).message + "；已保留文件，可使用原请求重试。"); } finally { setBusy(false); }
  }
  async function remove(item: MediaItem) {
    if (!confirm(`确认移除“${item.originalFilename}”？草稿、历史或已发布内容仍有引用时不能删除。`)) return;
    setBusy(true); setError("");
    const key = deleteRetries.current.get(item.id) || crypto.randomUUID(); deleteRetries.current.set(item.id, key);
    try { await apiResponse("media/" + item.id, "DELETE", undefined, { "Idempotency-Key": key }); deleteRetries.current.delete(item.id); setItems(previous => previous.filter(m => m.id !== item.id)); setMessage("媒体已移除。"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section><div className="admin-page-heading"><div><h2>媒体库</h2><p className="muted">上传照片，处理完成后可用于封面、正文或相册。</p></div><button className="button secondary" disabled={busy} onClick={() => load().catch(e => setError(e.message))}>刷新状态</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <form className="panel" onSubmit={upload}><label className="form-field"><span>选择图片</span><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} required onChange={e => { setFile(e.target.files?.[0] || null); pending.current = null; }}/></label><p className="small muted">支持静态 JPEG、PNG、WebP，单张不超过 10 MiB、2400 万像素。公开展示图会去除拍摄元数据。</p><button className="button primary" disabled={!file || busy}>{busy ? "正在上传…" : "上传图片"}</button></form>
    <div className="media-grid">{items.map(item => <article className="panel media-card" key={item.id}>{item.processingStatus === "READY" ? <img src={`/api/v1/admin/media/${item.id}/image?variant=THUMBNAIL`} alt={item.originalFilename} loading="lazy"/> : <div className="media-status">{{ UPLOADING: "正在接收原图", PROCESSING: "正在处理图片", READY: "可用", FAILED: "处理失败" }[item.processingStatus]}</div>}<h3>{item.originalFilename}</h3><p className="small muted">{(item.sizeBytes / 1024 / 1024).toFixed(2)} MiB · {item.width || "—"} × {item.height || "—"}</p><div className="admin-actions"><a className="text-button" href={`/api/v1/admin/media/${item.id}/original`}>下载原图</a><button className="text-button" disabled={busy} onClick={() => remove(item)}>删除</button></div></article>)}</div>
    {loaded && !items.length && <div className="empty-state"><h3>还没有图片</h3><p>上传后会在这里显示处理状态。</p></div>}{cursor && <button className="button secondary" disabled={busy} onClick={() => { setBusy(true); load(true).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>加载更多</button>}
  </section>;
}
