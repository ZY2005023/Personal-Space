import { Prisma } from "@/generated/prisma/client";
import { DomainError, type Payload } from "./domain";
import { assertNoReferences, resolveReferences } from "./references";
export type Tx = Prisma.TransactionClient;
type LockTable = "contents" | "categories" | "tags" | "media";
const identifiers: Record<LockTable, Prisma.Sql> = { contents: Prisma.sql`contents`, categories: Prisma.sql`categories`, tags: Prisma.sql`tags`, media: Prisma.sql`media` };
export async function lockRows(tx: Tx, table: LockTable, ids: string[]) {
  const sorted = [...new Set(ids)].sort(); if (!sorted.length) return;
  const identifier = identifiers[table]; if (!identifier) throw new DomainError(500, "INTERNAL_ERROR", "不允许的锁定资源");
  await tx.$queryRaw(Prisma.sql`SELECT id::text FROM ${identifier} WHERE id IN (${Prisma.join(sorted.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
}
export async function lockReferences(tx: Tx, payloads: Payload[]) {
  await lockRows(tx, "categories", payloads.flatMap(p => p.categoryId ? [p.categoryId] : []));
  await lockRows(tx, "tags", payloads.flatMap(p => p.tagIds));
  await lockRows(tx, "media", payloads.flatMap(p => p.placements.map(m => m.mediaId)));
}
export async function hydrateReferences(tx: Tx, payload: Payload, adminId: string, requireReady: boolean): Promise<Payload> {
  const [categories, tags, media] = await Promise.all([
    payload.categoryId ? tx.category.findMany({ where: { id: payload.categoryId }, select: { id: true, name: true, slug: true, module: true, deletedAt: true } }) : [],
    tx.tag.findMany({ where: { id: { in: payload.tagIds } }, select: { id: true, name: true, slug: true, deletedAt: true } }),
    tx.media.findMany({ where: { id: { in: [...new Set(payload.placements.map(p => p.mediaId))] } }, select: { id: true, processingStatus: true, uploadedBy: true, deletedAt: true } }),
  ]);
  return { ...payload, taxonomySnapshot: resolveReferences(payload, { categories, tags, media }, adminId, requireReady) };
}
/** Call inside the same transaction as soft-deleting the media row. No object is deleted here. */
export async function assertMediaCanDelete(tx: Tx, mediaId: string) {
  await lockRows(tx, "media", [mediaId]);
  if (!await tx.media.findFirst({ where: { id: mediaId, deletedAt: null }, select: { id: true } })) throw new DomainError(404, "NOT_FOUND", "图片不存在");
  const [draft, history, publication] = await Promise.all([tx.draftMedia.count({ where: { mediaId } }), tx.revisionMedia.count({ where: { mediaId } }), tx.contentMedia.count({ where: { mediaId } })]);
  assertNoReferences({ draft, history, publication });
}
/** Renames and deletions must follow the same resource locks as reference creation. */
export async function assertTaxonomyCanDelete(tx: Tx, kind: "category" | "tag", id: string) {
  await lockRows(tx, kind === "category" ? "categories" : "tags", [id]);
  if (kind === "category") {
    if (!await tx.category.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) throw new DomainError(404, "NOT_FOUND", "分类不存在");
    const [draft, history, publication, children] = await Promise.all([tx.draftCategory.count({ where: { categoryId: id } }), tx.revisionCategory.count({ where: { categoryId: id } }), tx.contentPublication.count({ where: { categoryId: id } }), tx.category.count({ where: { parentId: id, deletedAt: null } })]);
    assertNoReferences({ draft, history, publication, children });
  } else {
    if (!await tx.tag.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) throw new DomainError(404, "NOT_FOUND", "标签不存在");
    const [draft, history, publication] = await Promise.all([tx.draftTag.count({ where: { tagId: id } }), tx.revisionTag.count({ where: { tagId: id } }), tx.contentTag.count({ where: { tagId: id } })]);
    assertNoReferences({ draft, history, publication });
  }
}
