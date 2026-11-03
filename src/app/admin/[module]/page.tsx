import Link from "next/link";
import { ensureAdmin } from "@/lib/admin";
import { notFound } from "next/navigation";
const modules: Record<string, [string, string]> = { backups: ["导出与备份", "任务执行器、异地副本和恢复演练尚未接通；不会用模拟成功代替真实备份。"] };
export default async function Module({ params }: { params: Promise<{ module: string }> }) {
  await ensureAdmin(); const { module } = await params; const info = modules[module]; if (!info) notFound();
  return <section className="admin-placeholder"><h2>{info[0]}</h2><p className="muted">{info[1]}</p><p className="notice warning">此模块尚未达到 V1.0 验收条件。</p><Link className="button secondary" href="/admin/contents">返回内容管理 →</Link></section>;
}
