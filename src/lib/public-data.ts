import { DomainError, viewPublic } from "./domain";
import { previewEnabled, previewItems } from "./preview";
import { normalizedFilters, publishedById, publishedByPath, publishedPage, publicTaxonomy as readTaxonomy, type PublicFilters } from "./public-store";
import { paginate } from "./pagination";
import { searchFields } from "./references";
export type { PublicContent } from "./public-store";
export async function publicPage(input: PublicFilters = {}) {
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
  if (!previewEnabled() && process.env.DATABASE_URL) return publishedPage(input);
  const f = normalizedFilters(input);
  const items = previewEnabled() ? previewItems().map(viewPublic) : [];
  const ranked = items.filter(c => (!f.module || c.payload.module === f.module) && (!f.type || c.payload.type === f.type) && (!f.categoryId || c.payload.categoryId === f.categoryId) && (!f.tagId || c.payload.tagIds.includes(f.tagId))).map(c => {
    const d = searchFields(c.payload), contains = (s: string) => s.toLowerCase().includes(f.q);
    const score = f.q ? (contains(d.title) ? 100 : 0) + (contains(d.summary) ? 40 : 0) + (contains(d.categoryText) || contains(d.tagsText) ? 30 : 0) + (contains(d.searchableText) ? 10 : 0) : 0;
    return { ...c, score };
  }).filter(c => !f.q || c.score > 0);
  const page = paginate(ranked, input.limit || 20, input.cursor || null, f);
  return { data: page.data.map(({ score: _score, ...content }) => content), meta: page.meta };
}
export async function publicContents(input: PublicFilters = {}) { return (await publicPage(input)).data; }
export async function publicById(id: string) {
  if (previewEnabled()) { const item = previewItems().find(c => c.state.id === id.toLowerCase()); if (item) return viewPublic(item); }
  else if (process.env.DATABASE_URL) return publishedById(id);
  throw new DomainError(404, "NOT_FOUND", "内容不存在");
}
export async function publicTaxonomy(kind: "categories" | "tags") {
  if (!process.env.DATABASE_URL || previewEnabled()) return [];
  return readTaxonomy(kind);
}
export async function publicByPath(path: string) {
  if (previewEnabled()) {
    const item = previewItems().find(a => a.canonicalPath === path || a.aliases.includes(path));
    if (!item) throw new DomainError(404, "NOT_FOUND", "内容不存在");
    return { content: viewPublic(item), alias: item.canonicalPath !== path };
  }
  if (!process.env.DATABASE_URL) throw new DomainError(404, "NOT_FOUND", "内容不存在");
  return publishedByPath(path);
}
