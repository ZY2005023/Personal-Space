import { DomainError, type Payload, type Taxonomy } from "./domain";
export type CategoryReference = { id: string; module: string; name: string; slug: string; deletedAt: Date | null };
export type TagReference = { id: string; name: string; slug: string; deletedAt: Date | null };
export type MediaReference = { id: string; processingStatus: string; deletedAt: Date | null; uploadedBy: string };
export type ReferenceCatalog = { categories: CategoryReference[]; tags: TagReference[]; media: MediaReference[] };
/** Resolve only server-owned labels. A snapshot stores its own detached copy. */
export function resolveReferences(payload: Payload, catalog: ReferenceCatalog, adminId: string, requireReady = false): Taxonomy {
  const category = payload.categoryId ? catalog.categories.find(c => c.id === payload.categoryId) : null;
  if (payload.categoryId && (!category || category.deletedAt || category.module !== payload.module)) throw new DomainError(422, "INVALID_INPUT", "分类不存在、已删除或不属于当前模块");
  const tags = payload.tagIds.map(id => {
    const tag = catalog.tags.find(t => t.id === id); if (!tag || tag.deletedAt) throw new DomainError(422, "INVALID_INPUT", "标签不存在或已删除");
    return { id: tag.id, name: tag.name, slug: tag.slug };
  });
  for (const id of new Set(payload.placements.map(p => p.mediaId))) {
    const media = catalog.media.find(m => m.id === id);
    if (!media || media.deletedAt || media.uploadedBy !== adminId) throw new DomainError(422, "INVALID_INPUT", "图片不存在、已删除或不可引用");
    if (requireReady && media.processingStatus !== "READY") throw new DomainError(422, "MEDIA_NOT_READY", "有图片尚未处理完成，请稍后再发布或恢复");
  }
  return { category: category ? { id: category.id, name: category.name, slug: category.slug } : null, tags };
}
export function mediaRows(payload: Payload) {
  return payload.placements.map((p, sortOrder) => ({ placementId: p.placementId, mediaId: p.mediaId, role: p.role, sortOrder, caption: p.caption, altText: p.altText }));
}
export function searchFields(payload: Payload) {
  const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
  return { title: normalize(payload.title), summary: normalize(payload.summary), searchableText: normalize(payload.bodyMarkdown), categoryText: normalize(payload.taxonomySnapshot.category?.name || ""), tagsText: normalize(payload.taxonomySnapshot.tags.map(t => t.name).join(" ")), module: payload.module, contentType: payload.type };
}
export function assertNoReferences(counts: Record<string, number>) {
  if (Object.values(counts).some(n => n > 0)) throw new DomainError(409, "RESOURCE_REFERENCED", "仍被草稿、历史或已发布内容引用，不能删除");
}
