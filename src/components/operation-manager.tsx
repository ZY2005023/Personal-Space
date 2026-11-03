"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, securityApi, ApiError } from "./admin-client";
import { recordLabel } from "./backup-records";
type Job = { id: string; jobType: string; status: string; attempts: number; errorCode: string | null; resultResourceId: string | null };
export function OperationManager({ mode, initialJob }: { mode: "EXPORT" | "BACKUP"; initialJob?: string }) {
  const [includeMedia, setIncludeMedia] = useState(true), [password, setPassword] = useState(""), [code, setCode] = useState(""), [recovery, setRecovery] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [job, setJob] = useState<Job | null>(null), [jobId, setJobId] = useState(initialJob || ""), [refresh, setRefresh] = useState(0), [expired, setExpired] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null), label = mode === "EXPORT" ? "内容导出" : "手动备份";
  useEffect(() => {
    if (!jobId) return; let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const result = await api<Job>(`jobs/${jobId}`); if (cancelled) return; if (result.jobType !== mode) throw new Error("任务类型不匹配"); setJob(result); setError(""); if (!["SUCCEEDED", "FAILED"].includes(result.status)) timer = setTimeout(poll, 3000); } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : "任务查询失败"); setExpired(e instanceof ApiError && e.status === 401); } } }
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, mode, refresh]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const body = mode === "EXPORT" ? { includeMedia } : undefined, identity = JSON.stringify(body || {});
    if (!attempt.current || attempt.current.body !== identity) attempt.current = { body: identity, key: crypto.randomUUID() };
    try {
      const proof = await securityApi<{ token: string }>("reauthenticate", { operation: mode === "EXPORT" ? "EXPORT_CREATE" : "BACKUP_CREATE", password, code, recovery });
      const next = await api<Job>(mode === "EXPORT" ? "exports" : "backups", "POST", body, { "X-Reauth-Token": proof.token, "Idempotency-Key": attempt.current.key });
      setJob(next); setJobId(next.id); attempt.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "任务创建失败"); setExpired(e instanceof ApiError && e.status === 401); }
    finally { setPassword(""); setCode(""); setBusy(false); }
  }
  return <section className="panel operation-manager"><h3>{label}</h3><p className="small muted">{mode === "EXPORT" ? "导出草稿、历史、目录及媒体清单，可选择包含原图。" : "创建数据库与必要媒体的一致性备份，并分别记录本地、校验与异地状态。"}</p>{error && <p className="notice warning" role="alert">{error}</p>}
    {expired && <p><Link href="/login" target="_blank" rel="noopener noreferrer">在新窗口重新登录</Link>后可刷新任务。</p>}{jobId ? <div><p role="status">{job ? `${label}：${recordLabel(job.status)}，已尝试 ${job.attempts} 次` : "正在读取任务…"}</p>{job?.errorCode && <p className="small">错误标识：{job.errorCode}</p>}<div className="admin-actions">{job?.status === "SUCCEEDED" && job.resultResourceId && (mode === "EXPORT" ? <a className="button primary" href={`/api/v1/admin/exports/${job.resultResourceId}/download`}>下载 ZIP</a> : <Link className="button primary" href={`/admin/backups/${job.resultResourceId}`}>查看备份详情</Link>)}<button className="button secondary" type="button" onClick={() => setRefresh(n => n + 1)}>刷新任务</button>{(error || ["SUCCEEDED", "FAILED"].includes(job?.status || "")) && <button className="text-button" type="button" onClick={() => { setJob(null); setJobId(""); setError(""); }}>创建新任务</button>}</div><p className="small"><Link href={`/admin/backups?${mode === "EXPORT" ? "exportJob" : "backupJob"}=${jobId}`}>保留此任务链接</Link></p><p className="small muted">{mode === "EXPORT" ? "下载需保持登录；文件过期后请重新导出。" : "任务完成不代表异地副本已成功，请查看各项状态。"}</p></div> : <form onSubmit={submit}><fieldset disabled={busy}>{mode === "EXPORT" && <label className="recovery-login-option"><input type="checkbox" checked={includeMedia} onChange={e => setIncludeMedia(e.target.checked)}/><span>包含未删除媒体的原图</span></label>}<div className="form-field"><label htmlFor={`${mode}-password`}>当前密码</label><input id={`${mode}-password`} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></div><div className="form-field"><label htmlFor={`${mode}-code`}>{recovery ? "一次性恢复码" : "验证器验证码"}</label><input id={`${mode}-code`} autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} required value={code} onChange={e => setCode(e.target.value)} maxLength={recovery ? 128 : 6} pattern={recovery ? undefined : "[0-9]{6}"}/></div><label className="recovery-login-option"><input type="checkbox" checked={recovery} onChange={e => { setRecovery(e.target.checked); setCode(""); }}/><span>使用恢复码</span></label><button className="button primary" disabled={busy} type="submit">{busy ? "正在验证并创建…" : `验证并创建${label}`}</button></fieldset></form>}
  </section>;
}
