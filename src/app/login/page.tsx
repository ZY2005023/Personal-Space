import { Nav } from "@/components/nav";
import { LoginForm } from "@/components/login-form";
import { configurationMissing } from "@/lib/admin";
export const dynamic = "force-dynamic";
export const metadata = { title: "管理员登录", robots: { index: false, follow: false } };
export default function Login() {
  const missing = configurationMissing();
  return <><Nav /><main id="main" className="login-page">{missing.length ? <section className="login-card"><div className="login-step">管理空间</div><h1>空间尚未初始化</h1><p className="muted">请先完成管理员与安全配置，再进入后台。</p><p className="notice">当前没有开放注册或演示管理员入口。</p><p className="small muted">本地项目的 README 中有初始化准备说明；本次不会自动创建数据库、迁移或账号。</p></section> : <LoginForm />}</main></>;
}
