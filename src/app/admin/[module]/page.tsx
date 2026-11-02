import Link from "next/link";
import { ensureAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
const modules: Record<string, [string, string]> = { media: ["媒体库", "媒体上传、派生图片与三层引用保护尚未接通，当前不会接收或删除文件。"], taxonomy: ["分类与标签", "分类与标签的管理入口正在接入，暂不能在这里新增或修改。"], backups: ["导出与备份", "任务执行器、异地副本和恢复演练尚未接通；不会用模拟成功代替真实备份。"], security: ["安全与设置", "管理员会话使用 Auth.js，登录要求密码及双因素认证。安全凭据管理与敏感操作重新认证仍待接入。"], audit: ["审计记录", "内容变更的必要操作摘要保存在审计记录中。"] };
export default async function Module({ params }: { params: Promise<{ module: string }> }) {
  await ensureAdmin(); const { module } = await params; const info = modules[module]; if (!info) notFound();
  const logs = module === "audit" ? await db().auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }) : [];
  return <section className="admin-placeholder"><h2>{info[0]}</h2><p className="muted">{info[1]}</p>{module !== "audit" && <p className="notice warning">此模块尚未达到 V1.0 验收条件。</p>}{logs.map(l => <article className="content-card" key={l.id}><h3>{l.action.split(":").at(-1)}</h3><p className="small muted">{l.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })} · {l.targetType}</p></article>)}<Link className="button secondary" href="/admin/contents">返回内容管理 →</Link></section>;
}
