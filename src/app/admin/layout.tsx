import { AdminShell } from "@/components/admin-shell";
import { ensureAdmin } from "@/lib/admin";
export const dynamic = "force-dynamic";
export const metadata = { title: "管理空间", robots: { index: false, follow: false } };
export default async function AdminLayout({ children }: { children: React.ReactNode }) { await ensureAdmin(); return <AdminShell>{children}</AdminShell>; }
