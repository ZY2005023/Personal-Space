import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError, parseStoredPayload } from "./domain";
import { lockRows } from "./reference-store";
import { searchFields } from "./references";
const stateEvent = z.object({ stateVersion: z.number().int().min(1).max(2147483647), revisionId: z.uuid().transform(value => value.toLowerCase()).nullable() }).strict();
/** Reconcile live state, never replay historical event payloads into search. Caller owns event lease lock. */
export async function reconcileContentSearch(tx: Prisma.TransactionClient, contentId: string, eventPayload: unknown) {
  const parsed = stateEvent.safeParse(eventPayload);
  if (!z.uuid().safeParse(contentId).success || !parsed.success) throw new DomainError(422, "INVALID_INPUT", "内容状态事件无效");
  await lockRows(tx, "contents", [contentId]);
  const content = await tx.content.findUnique({ where: { id: contentId }, select: { id: true, type: true, module: true, stateVersion: true, publicationState: true, effectiveVisibility: true, deletedAt: true, publishedRevisionId: true, lastPublishedAt: true } });
  if (!content) { await tx.contentSearchDocument.deleteMany({ where: { contentId } }); return; }
  if (parsed.data.stateVersion > content.stateVersion || parsed.data.stateVersion === content.stateVersion && parsed.data.revisionId !== content.publishedRevisionId) throw new DomainError(422, "INVALID_INPUT", "事件与当前内容状态不一致");
  if (content.publicationState !== "PUBLISHED" || content.effectiveVisibility !== "PUBLIC" || content.deletedAt) {
    await tx.contentSearchDocument.deleteMany({ where: { contentId } }); return;
  }
  if (!content.publishedRevisionId || !content.lastPublishedAt) throw new DomainError(500, "INTERNAL_ERROR", "当前发布状态不完整");
  const revision = await tx.contentRevision.findFirst({ where: { contentId, id: content.publishedRevisionId, revisionKind: "PUBLISHED" }, select: { snapshot: true } });
  if (!revision) throw new DomainError(500, "INTERNAL_ERROR", "当前发布快照不存在");
  const payload = parseStoredPayload(revision.snapshot);
  if (payload.type !== content.type || payload.module !== content.module) throw new DomainError(500, "INTERNAL_ERROR", "当前发布类型不一致");
  // Match publisher lock order: content -> categories -> tags -> search document.
  await lockRows(tx, "categories", payload.categoryId ? [payload.categoryId] : []);
  await lockRows(tx, "tags", payload.tagIds);
  const category = payload.categoryId ? await tx.category.findFirst({ where: { id: payload.categoryId, deletedAt: null, module: payload.module }, select: { id: true, name: true, slug: true } }) : null;
  const tags = payload.tagIds.length ? await tx.tag.findMany({ where: { id: { in: payload.tagIds }, deletedAt: null }, select: { id: true, name: true, slug: true } }) : [];
  if ((payload.categoryId && !category) || tags.length !== payload.tagIds.length) throw new DomainError(500, "INTERNAL_ERROR", "当前发布目录引用不完整");
  const tagMap = new Map(tags.map(tag => [tag.id, tag]));
  const document = { revisionId: content.publishedRevisionId, ...searchFields({ ...payload, taxonomySnapshot: { category, tags: payload.tagIds.map(id => tagMap.get(id)!) } }), publishedAt: content.lastPublishedAt };
  await tx.contentSearchDocument.upsert({ where: { contentId }, create: { contentId, ...document }, update: document });
}
