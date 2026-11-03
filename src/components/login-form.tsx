"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
export function LoginForm() {
  const [step, setStep] = useState(1), [recovery, setRecovery] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [code, setCode] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); if (step === 1) { setStep(2); return; }
    setBusy(true);
    try {
      const result = await signIn("credentials", { username, password, code, recovery: String(recovery), redirect: false });
      if (result?.error) setError("验证未通过，请检查登录信息或稍后重试。");
      else { setPassword(""); setCode(""); location.assign(recovery ? "/admin/security?recovery=1" : "/admin"); }
    } catch { setError("暂时无法登录，请稍后重试。"); } finally { setBusy(false); }
  }
  return <form className="login-card" onSubmit={submit}><div className="login-step">{step === 1 ? "01 / 管理员登录" : "02 / 验证身份"}</div><h1>进入管理空间</h1><p className="muted small">{step === 1 ? "欢迎回来，继续让这里慢慢生长。" : recovery ? "使用一枚尚未消费的恢复码。" : "输入验证器中的六位验证码。"}</p>{step === 1 ? <><label className="form-field"><span>用户名</span><input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required maxLength={100} autoFocus /></label><label className="form-field"><span>密码</span><input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required maxLength={1024}/></label></> : <><label className="form-field"><span>{recovery ? "一次性恢复码" : "验证码"}</span><input key={String(recovery)} value={code} onChange={e => setCode(e.target.value)} inputMode={recovery ? "text" : "numeric"} autoComplete="one-time-code" required pattern={recovery ? undefined : "[0-9]{6}"} maxLength={recovery ? 128 : 6} autoFocus /></label><button className="text-button" type="button" onClick={() => { setRecovery(!recovery); setCode(""); }}>{recovery ? "使用验证器" : "使用恢复码"}</button></>}{error && <p className="notice error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy ? "正在验证…" : step === 1 ? "下一步 →" : "验证并登录"}</button>{step === 2 && <button className="text-button" type="button" onClick={() => { setStep(1); setCode(""); }}>返回修改登录信息</button>}<p className="small muted" style={{ marginTop: 30, marginBottom: 0 }}>本站仅管理员可登录，不开放注册。</p></form>;
}
