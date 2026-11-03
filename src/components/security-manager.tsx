"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, securityApi } from "./admin-client";
type Operation = "PASSWORD_CHANGE" | "MFA_REPLACE" | "RECOVERY_RESET" | "SESSIONS_REVOKE";
type Enrollment = { bindingToken: string; secret: string; uri: string; expiresAt: string };
const labels: Record<Operation, string> = { PASSWORD_CHANGE: "修改密码", MFA_REPLACE: "更换验证器", RECOVERY_RESET: "重置恢复码", SESSIONS_REVOKE: "撤销所有会话" };
export function SecurityManager({ recoveryLoginRequested = false }: { recoveryLoginRequested?: boolean }) {
  const [status, setStatus] = useState<{ mfaEnabled: boolean; sessionVersion: number; unusedRecoveryCodeCount: number } | null>(null), [operation, setOperation] = useState<Operation>(recoveryLoginRequested ? "MFA_REPLACE" : "PASSWORD_CHANGE");
  const [recentRecovery, setRecentRecovery] = useState(recoveryLoginRequested);
  const [password, setPassword] = useState(""), [code, setCode] = useState(""), [recovery, setRecovery] = useState(false), [newPassword, setNewPassword] = useState(""), [repeat, setRepeat] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null), [newCode, setNewCode] = useState(""), [codes, setCodes] = useState<string[]>([]), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState("");
  useEffect(() => { let cancelled = false; api<NonNullable<typeof status>>("security").then(value => { if (!cancelled) setStatus(value); }).catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  function clearCredentials() { setPassword(""); setCode(""); setNewPassword(""); setRepeat(""); }
  function completed(result: { recoveryCodes?: string[] }) { setCodes(result.recoveryCodes || []); setEnrollment(null); setNewCode(""); clearCredentials(); setDone(true); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setError("");
    if (operation === "PASSWORD_CHANGE" && newPassword !== repeat) { setError("两次新密码不一致。"); return; }
    if (!confirm(operation === "MFA_REPLACE" ? "开始更换验证器？旧验证器将在新验证器确认成功后失效。" : `确认${labels[operation]}？成功后包括当前页面在内的所有会话都会失效。`)) return;
    setBusy(true);
    try {
      if (operation === "MFA_REPLACE" && recentRecovery) setEnrollment(await securityApi<Enrollment>("recovery-mfa-start", { password }));
      else {
        const proof = await securityApi<{ token: string }>("reauthenticate", { operation, password, code, recovery });
        if (operation === "MFA_REPLACE") setEnrollment(await securityApi<Enrollment>("mfa-start", { token: proof.token }));
        else { const action = { PASSWORD_CHANGE: "password", RECOVERY_RESET: "recovery-codes", SESSIONS_REVOKE: "revoke-sessions" }[operation]; completed(await securityApi(action, { token: proof.token, ...(operation === "PASSWORD_CHANGE" ? { newPassword } : {}) })); }
      }
    } catch (e) { setError((e as Error).message + (recentRecovery ? "。可在本次恢复登录原有5分钟内重新输入密码重试；已完成或取消的换绑不能重用。" : "。若请求中断，请先检查登录状态；再次验证需使用新的验证码或未使用的恢复码。")); }
    finally { clearCredentials(); setBusy(false); }
  }
  async function confirmMfa(event: React.FormEvent) {
    event.preventDefault(); if (!enrollment || busy) return; setBusy(true); setError("");
    try { completed(await securityApi("mfa-confirm", { bindingToken: enrollment.bindingToken, code: newCode })); }
    catch (e) { setError((e as Error).message); } finally { setNewCode(""); setBusy(false); }
  }
  async function cancelMfa() {
    if (!enrollment || busy) return;
    if (recentRecovery && !confirm("取消将作废本次恢复登录的换绑确认。如果没有其他恢复码或验证器，将无法继续在线换绑。确认取消？")) return;
    setBusy(true); setError("");
    try { await securityApi("mfa-cancel", { bindingToken: enrollment.bindingToken }); setEnrollment(null); setNewCode(""); }
    catch (e) { setError((e as Error).message + "。若绑定已过期，可以刷新页面；原验证器保持有效。"); }
    finally { setBusy(false); }
  }
  return <section className="security-page"><div className="admin-page-heading"><div><h2>账号安全</h2><p className="muted">本站只有一位管理员，不开放注册。</p></div></div>{error && <p className="notice error" role="alert">{error}</p>}
    {done ? <div className="panel"><h3>安全设置已更新</h3><p role="status">全部旧会话已撤销，请重新登录。</p>{codes.length > 0 && <><p className="notice warning">旧恢复码已失效。新恢复码只在这里展示一次，请离线保存；每枚只能使用一次。离开或刷新页面后无法找回。</p><ul className="recovery-codes">{codes.map(value => <li key={value}><code>{value}</code></li>)}</ul></>}<Link className="button primary" href="/login" onClick={() => setCodes([])}>{codes.length ? "我已保存恢复码，返回登录" : "返回登录"}</Link></div> : enrollment ? <form className="panel" onSubmit={confirmMfa}><h3>绑定新的验证器</h3><p>在验证器中添加“Personal Space”，手动输入以下密钥。密钥与恢复码一样需要保密。</p><p className="security-secret"><code>{enrollment.secret}</code></p><p className="small muted">本次绑定于 {new Date(enrollment.expiresAt).toLocaleTimeString("zh-CN")} 到期。在确认前，原验证器继续有效。</p><label className="form-field"><span>新验证器中的六位验证码</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={newCode} disabled={busy} onChange={e => setNewCode(e.target.value)}/></label><div className="admin-actions"><button className="button primary" disabled={busy}>确认并更换</button><button type="button" className="button secondary" disabled={busy} onClick={cancelMfa}>取消更换</button></div><p className="small muted">成功后原验证器、旧恢复码及所有旧会话均会失效；请保存随后展示的新恢复码。</p></form> : <>
      <div className="panel"><h3>当前状态</h3><p className="small muted">验证器丢失时，请选择更换验证器；恢复码登录后会有5分钟受控换绑机会。</p>{status ? <p>双因素认证：{status.mfaEnabled ? "已启用" : "未启用"} · 剩余恢复码：{status.unusedRecoveryCodeCount}</p> : <p role="status">正在读取安全状态…</p>}</div>
      <form className="panel" onSubmit={submit}><h3>安全操作</h3><fieldset disabled={busy || !status}><label className="form-field"><span>需要执行的操作</span><select value={operation} onChange={e => { setOperation(e.target.value as Operation); setRecentRecovery(false); clearCredentials(); setError(""); }}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><p className="small muted">每次操作均验证当前密码和第二因素。刚登录使用过的验证码不能再次使用，请等下一组。</p><label className="form-field"><span>当前密码</span><input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)}/></label>{operation === "MFA_REPLACE" && <label className="recovery-login-option"><input type="checkbox" checked={recentRecovery} onChange={e => { setRecentRecovery(e.target.checked); setCode(""); }}/><span>使用本次恢复码登录确认（5分钟内，仅限换绑）</span></label>}{recentRecovery && operation === "MFA_REPLACE" ? <p className="notice">本次登录已经验证过恢复码，无需再消费另一枚。请再次输入密码并绑定新验证器，完成后会生成新恢复码。</p> : <><label className="form-field"><span>{recovery ? "尚未使用的恢复码" : "当前验证器中的验证码"}</span><input required autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} pattern={recovery ? undefined : "[0-9]{6}"} maxLength={recovery ? 128 : 6} value={code} onChange={e => setCode(e.target.value)}/></label><button className="text-button" type="button" onClick={() => { setRecovery(!recovery); setCode(""); }}>{recovery ? "使用验证器" : "使用恢复码"}</button></>}{operation === "PASSWORD_CHANGE" && <><label className="form-field"><span>新密码（15至128个字符）</span><input type="password" autoComplete="new-password" required minLength={15} maxLength={256} value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label><label className="form-field"><span>再次输入新密码</span><input type="password" autoComplete="new-password" required value={repeat} onChange={e => setRepeat(e.target.value)}/></label></>}<p className="notice warning">{operation === "MFA_REPLACE" ? "请准备新的验证器，并在完成后保存新恢复码。" : "成功后，当前及其他设备上的所有旧会话都会失效。"}</p><button className="button primary" disabled={busy || !status}>{busy ? "正在验证并处理…" : "验证并继续"}</button></fieldset></form>
    </>}
  </section>;
}
