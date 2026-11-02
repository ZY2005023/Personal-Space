import { ensureAdmin } from "@/lib/admin";
import { getContent } from "@/lib/content-store";
import { viewAdmin, DomainError } from "@/lib/domain";
import { Editor } from "@/components/editor";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
export default async function Edit({ params }: { params: Promise<{ id: string }> }) {
  await ensureAdmin(); const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const item = await getContent(id).catch(e => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  if (item.state.deletedAt) redirect("/admin/trash"); return <Editor initial={viewAdmin(item)}/>;
}
