import { ensureAdmin } from "@/lib/admin";
import { listAdmin } from "@/lib/content-store";
import { AdminList } from "@/components/admin-list";
export default async function Contents() { await ensureAdmin(); return <AdminList items={await listAdmin()} />; }
