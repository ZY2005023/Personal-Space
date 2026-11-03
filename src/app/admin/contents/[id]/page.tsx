import { ensureAdmin } from "@/lib/admin";
import { getAdminModel } from "@/lib/admin-read-store";
import { DomainError } from "@/lib/domain";
import { Editor } from "@/components/editor";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
export default async function Edit({ params }: { params: Promise<{ id: string }> }) {
  const session = await ensureAdmin(); const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const item = await getAdminModel(session.user.id, id).catch(e => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  if (item.state.deletedAt) redirect("/admin/trash"); return <Editor initial={item}/>;
}
