"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiResponse, ApiError } from "./admin-client";
import type { SiteSettings } from "@/lib/site-settings";
export function SettingsManager() {
  const router = useRouter();
  const [settings, setSettings] = useState<SiteSettings | null>(null), [title, setTitle] = useState(""), [intro, setIntro] = useState(""), [etag, setEtag] = useState<string | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false), [expired, setExpired] = useState(false);
  async function load() {
    setBusy(true); setError("");
    try { const result = await apiResponse<SiteSettings>("settings"); setSettings(result.data); setTitle(result.data.siteTitle); setIntro(result.data.siteIntro); setEtag(result.etag); setConflict(false); setExpired(false); }
    catch (e) { setError(e instanceof Error ? e.message : "读取失败"); if (e instanceof ApiError && e.status === 401) setExpired(true); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const dirty = settings && (title !== settings.siteTitle || intro !== settings.siteIntro);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    addEventListener("beforeunload", warn); return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!etag) return; setBusy(true); setError(""); setNotice("");
    try { const result = await apiResponse<SiteSettings>("settings", "PUT", { siteTitle: title, siteIntro: intro }, { "If-Match": etag }); setSettings(result.data); setTitle(result.data.siteTitle); setIntro(result.data.siteIntro); setEtag(result.etag); setConflict(false); setNotice("站点设置已保存，新打开的前台页面将使用新文案。"); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); if (e instanceof ApiError) { setConflict(e.status === 412); setExpired(e.status === 401); } }
    finally { setBusy(false); }
  }
  return <section className="site-settings-section"><div className="eyebrow">SITE / 站点设置</div><h2>站点文案</h2><p className="muted">用于网站名称、页脚介绍和浏览器页面信息。</p>
    {error && <p className="notice warning" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {expired && <p><Link href="/login" target="_blank" rel="noopener noreferrer">在新窗口重新登录</Link>，当前输入保留在这里。</p>}
    {!settings ? <button className="button secondary" disabled={busy} onClick={load}>{busy ? "读取中…" : "重新读取"}</button> : <form onSubmit={save} className="panel site-settings-form"><fieldset disabled={busy}><div className="form-field"><label htmlFor="site-title">网站名称</label><input id="site-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} required/><span className="small muted">{title.length}/100</span></div><div className="form-field"><label htmlFor="site-intro">网站介绍</label><textarea id="site-intro" rows={4} value={intro} onChange={e => setIntro(e.target.value)} maxLength={500}/><span className="small muted">{intro.length}/500</span></div><div className="settings-preview"><b>{title || "网站名称"}</b><p>{intro || "（未填写介绍）"}</p></div><p className="small muted">上传限额：{settings.uploadMaxBytes ? `${settings.uploadMaxBytes / 1024 / 1024} MiB` : "未设置"}；支持 {settings.allowedMimeTypes.map(type => type.replace("image/", "").toUpperCase()).join("、")}。这些限制由运行配置决定。</p><div className="admin-actions"><button className="button primary" disabled={!dirty || !title.trim() || conflict} type="submit">保存设置</button>{conflict && <button className="button secondary" type="button" onClick={load}>放弃当前输入并读取最新设置</button>}</div></fieldset></form>}
  </section>;
}
