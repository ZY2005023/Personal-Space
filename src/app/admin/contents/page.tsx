import Link from "next/link";
import { ensureAdmin } from "@/lib/admin";
import { adminFilters, adminPage } from "@/lib/admin-read-store";
import { DomainError } from "@/lib/domain";
import { AdminList } from "@/components/admin-list";
export default async function ListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await ensureAdmin(), raw = await searchParams, params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  params.set("deleted", "false");
  try { const filters = adminFilters(params); return <AdminList key={params.toString()} initial={await adminPage(session.user.id, filters)} filters={filters} trash={false}/>; }
  catch (e) { if (!(e instanceof DomainError) || e.status !== 400) throw e; return <section><h2>筛选或分页条件已失效</h2><p className="notice warning">请从第一页重新筛选，当前内容没有被修改。</p><Link className="button secondary" href="/admin/contents">返回列表</Link></section>; }
}
