"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PayloadInput, Revision, viewAdmin } from "@/lib/domain";
import { Markdown } from "./markdown";
import { api, ApiError } from "./admin-client";
type Model = ReturnType<typeof viewAdmin>;
function inputPayload(model: Model): PayloadInput { const { taxonomySnapshot: _snapshot, ...input } = model.draft.payload; return input; }
export function Editor({ initial }: { initial: Model }) {
  const router = useRouter(); const [model, setModel] = useState(initial), [payload, setPayload] = useState<PayloadInput>(inputPayload(initial));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [tab, setTab] = useState("edit"), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]), [remote, setRemote] = useState<Model | null>(null);
  const publishDialog = useRef<HTMLDialogElement>(null), settingsDialog = useRef<HTMLDialogElement>(null), historyDialog = useRef<HTMLDialogElement>(null), conflictDialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const base = `contents/${model.state.id}`;
  useEffect(() => { const block = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; addEventListener("beforeunload", block); return () => removeEventListener("beforeunload", block); }, [dirty]);
  function update<K extends keyof PayloadInput>(key: K, value: PayloadInput[K]) { setPayload(p => ({ ...p, [key]: value })); setDirty(true); setMessage(""); }
  function accept(next: Model) { setModel(next); setPayload(inputPayload(next)); setDirty(false); }
  async function failure(e: unknown) {
    setError((e as Error).message || "网络中断，当前输入已保留。可用原请求重试。");
    if (e instanceof ApiError && e.status === 412) {
      try { const latest = await api<Model>(base); setRemote(latest); conflictDialog.current?.showModal(); } catch { /* keep current input and original error */ }
    }
  }
  async function save() {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { const draft = await api<Model["draft"]>(base + "/draft", "PUT", payload, { "If-Match": model.draft.etag }); setModel(m => ({ ...m, draft })); setDirty(false); setMessage("草稿已保存，线上内容未改变。"); }
    catch(e) { await failure(e); } finally { setBusy(false); }
  }
  async function mutation<T>(suffix: string, match: string, body?: unknown) {
    const fingerprint = JSON.stringify({ suffix, match, body });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try { const result = await api<T>(base + suffix, "POST", body, { "If-Match": match, "Idempotency-Key": pending.current.key }); pending.current = null; return result; }
    catch(e) { if (e instanceof ApiError) pending.current = null; throw e; }
  }
  function openPublish() { setError(""); if (dirty) { setError("请先保存草稿，再核对并发布。"); return; } publishDialog.current?.showModal(); }
  async function publish() {
    if (busy) return; setBusy(true); setError("");
    try { const result = await mutation<{ content: Model; revision: Revision; firstPublication: boolean }>("/publish", model.draft.etag, { expectedStateEtag: model.state.stateEtag }); accept(result.content); publishDialog.current?.close(); setMessage(result.content.state.effectiveVisibility === "PUBLIC" ? "正式版本已发布。" : "正式版本已发布为私密。"); }
    catch(e) { publishDialog.current?.close(); await failure(e); } finally { setBusy(false); }
  }
  async function stateAction(action: string) {
    const description: Record<string, string> = { "make-private": "立即停止新的公开访问，保留当前工作草稿。确认转为私密？", unpublish: "撤回后停止公开访问，草稿与历史会保留。确认撤回？", trash: "移入回收站后停止公开访问，可恢复为私密。确认删除？" };
    if (!confirm(description[action])) return; setBusy(true); setError("");
    try { const next = await mutation<Model>("/" + action, model.state.stateEtag); setModel(previous => ({ ...previous, state: next.state })); if (action === "trash") router.push("/admin/trash"); else setMessage("访问状态已更新；未发布当前草稿。"); }
    catch(e) { await failure(e); } finally { setBusy(false); }
  }
  async function history() { setError(""); try { setRevisions(await api<Revision[]>(base + "/revisions")); historyDialog.current?.showModal(); } catch(e) { await failure(e); } }
  async function manualSnapshot() { if (dirty) { setError("请先保存草稿，再创建手动快照。"); return; } setBusy(true); try { await mutation<Revision>("/revisions", model.draft.etag); setMessage("不可变快照已创建，线上版本未改变。"); } catch(e) { await failure(e); } finally { setBusy(false); } }
  async function restore(r: Revision) {
    if (!confirm("将此版本恢复到工作草稿，会替换当前编辑内容，但不会改变线上版本。确认恢复？")) return; setBusy(true);
    try { const draft = await mutation<Model["draft"]>(`/revisions/${r.id}/restore`, model.draft.etag); accept({ ...model, draft }); historyDialog.current?.close(); setMessage("历史版本已恢复为工作草稿，请检查后再发布。"); } catch(e) { historyDialog.current?.close(); await failure(e); } finally { setBusy(false); }
  }
  return <><div className="editor-top"><div><label className="sr-only" htmlFor="content-title">内容标题</label><input id="content-title" className="editor-title" placeholder="写下一个标题…" maxLength={240} value={payload.title} onChange={e => update("title", e.target.value)} disabled={busy}/><div className="editor-status" aria-live="polite">{busy ? "正在处理…" : dirty ? "有未保存的更改" : `已保存 · 草稿版本 ${model.draft.revisionNumber}`} · {model.state.publicationState === "NEVER_PUBLISHED" ? "尚未发布" : model.state.effectiveVisibility === "PRIVATE" ? "当前私密" : "当前公开"}</div></div><div className="admin-actions editor-buttons"><button className="button secondary" onClick={() => settingsDialog.current?.showModal()} disabled={busy}>发布设置</button><button className="button secondary" onClick={save} disabled={busy || !dirty}>保存草稿</button><button className="button primary" onClick={openPublish} disabled={busy}>确认发布</button></div></div>
    {error && <div className="notice error" role="alert">{error}{error.includes("登录") && <> <Link href="/login" target="_blank">在新窗口登录</Link></>}</div>}{message && <div className="notice" role="status">{message}{model.state.effectiveVisibility === "PUBLIC" && !dirty && <Link style={{ marginLeft: 14 }} href={model.draft.payload.desiredPath} target="_blank">查看公开版本 ↗</Link>}</div>}
    <div className="editor-tabs" role="tablist" aria-label="编辑视图"><button role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>编辑</button><button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>预览</button></div><div className="editor-grid"><section className={`editor-pane ${tab !== "edit" ? "mobile-hidden" : ""}`}><div className="pane-title">Markdown 编辑</div><label className="sr-only" htmlFor="markdown">Markdown 正文</label><textarea id="markdown" className="editor-textarea" value={payload.bodyMarkdown} placeholder="从一段文字开始…" onChange={e => update("bodyMarkdown", e.target.value)} disabled={busy}/></section><section className={`editor-pane ${tab !== "preview" ? "mobile-hidden" : ""}`}><div className="pane-title">实时预览 · 未发布的草稿</div><div className="editor-preview"><Markdown body={payload.bodyMarkdown || "写下内容后，在这里预览。"}/></div></section></div>
    <div className="admin-actions" style={{ marginTop: 22 }}><button className="text-button" onClick={history} disabled={busy}>查看历史版本</button><button className="text-button" onClick={manualSnapshot} disabled={busy}>创建手动快照</button>{model.state.publicationState === "PUBLISHED" && <><button className="text-button" onClick={() => stateAction("make-private")} disabled={busy}>转为私密</button><button className="text-button" onClick={() => stateAction("unpublish")} disabled={busy}>撤回发布</button></>}<button className="text-button" style={{ color: "var(--red)" }} disabled={busy} onClick={() => stateAction("trash")}>移入回收站</button></div>
    <dialog ref={settingsDialog} className="editor-dialog" aria-labelledby="settings-heading"><div className="drawer-heading"><h2 id="settings-heading">发布设置</h2><button onClick={() => settingsDialog.current?.close()}>关闭 ×</button></div><label className="form-field"><span>期望可见性（确认发布后生效）</span><select value={payload.desiredVisibility} onChange={e => update("desiredVisibility", e.target.value as "PUBLIC" | "PRIVATE")}><option value="PRIVATE">私密</option><option value="PUBLIC">公开</option></select></label><label className="form-field"><span>发布地址</span><input value={payload.desiredPath} onChange={e => update("desiredPath", e.target.value)} maxLength={500}/></label><label className="form-field"><span>摘要</span><textarea value={payload.summary} onChange={e => update("summary", e.target.value)} maxLength={4000}/></label><p className="notice">设置随草稿保存，未确认发布前不会改变线上版本。</p><div className="dialog-actions"><button className="button primary" onClick={() => settingsDialog.current?.close()}>返回编辑并保存</button></div></dialog>
    <dialog ref={publishDialog} className="editor-dialog" aria-labelledby="publish-heading"><h2 id="publish-heading">确认发布</h2><p className="muted small">将已保存的草稿更新为正式版本。请再次核对可见性和地址。</p>{[["内容", model.draft.payload.title], ["可见性", model.draft.payload.desiredVisibility === "PUBLIC" ? "公开" : "私密"], ["目标地址", model.draft.payload.desiredPath], ["版本确认", `草稿 v${model.draft.revisionNumber} · 线上状态 v${model.state.stateVersion}`]].map(([label, value]) => <div className="confirm-row" key={label}><span>{label}</span><strong>{value || "尚未填写"}</strong></div>)}<div className="dialog-actions"><button className="button secondary" onClick={() => publishDialog.current?.close()} disabled={busy}>返回编辑</button><button className="button primary" onClick={publish} disabled={busy}>{busy ? "正在发布…" : "确认发布"}</button></div></dialog>
    <dialog ref={historyDialog} className="editor-dialog" aria-labelledby="history-heading"><h2 id="history-heading">历史版本</h2><p className="muted small">恢复只替换工作草稿，不改变线上内容。</p><div className="history-list">{revisions.map(r => <div key={r.id} className="panel"><h3>{r.revisionKind === "PUBLISHED" ? `正式发布 · 第 ${r.publishedEditionNumber} 版` : "手动快照"}</h3><p className="muted small">历史序号 {r.versionNumber} · {r.payload.title || "未命名草稿"}</p><details><summary className="text-button">查看内容</summary><Markdown body={r.payload.bodyMarkdown}/></details><button className="button secondary" onClick={() => restore(r)} disabled={busy}>恢复到草稿</button></div>)}{!revisions.length && <p>还没有历史版本。</p>}</div><div className="dialog-actions"><button className="button secondary" onClick={() => historyDialog.current?.close()}>关闭</button></div></dialog>
    <dialog ref={conflictDialog} className="editor-dialog" aria-labelledby="conflict-heading"><h2 id="conflict-heading">内容已在另一处更新</h2><p>当前输入仍保留。请比较差异，再决定是否载入服务器版本。</p><h3>本地内容</h3><pre style={{ whiteSpace: "pre-wrap" }}>{payload.title}{"\n\n"}{payload.bodyMarkdown}</pre><h3>服务器内容</h3><pre style={{ whiteSpace: "pre-wrap" }}>{remote?.draft.payload.title}{"\n\n"}{remote?.draft.payload.bodyMarkdown}</pre><div className="dialog-actions"><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); setMessage("本地草稿全部字段已复制。"); } catch { setError("无法自动复制，请手动选中本地内容复制。"); } }}>复制本地草稿</button><button className="button primary" onClick={() => { if (remote && confirm("将以服务器版本替换本地未保存内容。请先复制备份，确认继续？")) { accept(remote); conflictDialog.current?.close(); setError(""); } }}>载入服务器版本</button></div></dialog>
  </>;
}
