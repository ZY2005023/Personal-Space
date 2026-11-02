import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export class DomainError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const uuid = z.uuid().transform(value => value.toLowerCase());
export const PlacementSchema = z.strictObject({
  placementId: uuid, mediaId: uuid, role: z.enum(["COVER", "INLINE", "ALBUM_PHOTO"]),
  caption: z.string().max(2000), altText: z.string().max(1000),
});
export const PayloadSchema = z.strictObject({
  schemaVersion: z.literal(1), type: z.enum(["MOMENT", "ARTICLE", "ALBUM"]), module: z.enum(["LIFE", "KNOWLEDGE"]),
  title: z.string().max(240), summary: z.string().max(4000), bodyMarkdown: z.string(),
  desiredVisibility: z.enum(["PUBLIC", "PRIVATE"]),
  desiredPath: z.string().max(500).regex(/^\/(life|knowledge)\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/),
  categoryId: uuid.nullable(), tagIds: z.array(uuid), coverMediaId: uuid.nullable(), placements: z.array(PlacementSchema),
}).superRefine((p, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
  if (p.type !== "ARTICLE" && p.module !== "LIFE") issue("记录与相册只能属于生活模块", ["module"]);
  if (!p.desiredPath.startsWith(p.module === "LIFE" ? "/life/" : "/knowledge/")) issue("地址必须匹配所属模块", ["desiredPath"]);
  if (new Set(p.tagIds).size !== p.tagIds.length) issue("标签不能重复", ["tagIds"]);
  if (new Set(p.placements.map(p => p.placementId)).size !== p.placements.length) issue("每个图片项必须有独立标识", ["placements"]);
  const covers = p.placements.filter(p => p.role === "COVER");
  if (covers.length > 1 || (p.coverMediaId === null ? covers.length > 0 : covers.length !== 1 || covers[0].mediaId !== p.coverMediaId)) issue("封面与图片引用不一致", ["coverMediaId"]);
});
export type PayloadInput = z.infer<typeof PayloadSchema>;
export type Taxonomy = { category: { id: string; name: string; slug: string } | null; tags: { id: string; name: string; slug: string }[] };
export type Payload = PayloadInput & { taxonomySnapshot: Taxonomy };
const taxonomyItem = z.strictObject({ id: uuid, name: z.string(), slug: z.string() });
const TaxonomySchema = z.strictObject({ category: taxonomyItem.nullable(), tags: z.array(taxonomyItem) });
export function parseStoredPayload(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError(500, "INTERNAL_ERROR", "内容版本结构不完整");
  const { taxonomySnapshot, ...input } = value as Record<string, unknown>;
  const payload = PayloadSchema.safeParse(input), taxonomy = TaxonomySchema.safeParse(taxonomySnapshot);
  if (!payload.success || !taxonomy.success) throw new DomainError(500, "INTERNAL_ERROR", "内容版本结构不完整");
  const ids = taxonomy.data.tags.map(t => t.id);
  if ((taxonomy.data.category?.id || null) !== payload.data.categoryId || ids.length !== payload.data.tagIds.length || new Set(ids).size !== ids.length || ids.some(id => !payload.data.tagIds.includes(id))) throw new DomainError(500, "INTERNAL_ERROR", "内容分类标签快照不一致");
  return { ...payload.data, taxonomySnapshot: taxonomy.data };
}
export type State = {
  id: string; type: Payload["type"]; module: Payload["module"]; publicationState: "NEVER_PUBLISHED" | "PUBLISHED" | "UNPUBLISHED";
  effectiveVisibility: "PUBLIC" | "PRIVATE"; stateVersion: number; publishedRevisionId: string | null;
  firstPublishedAt: string | null; lastPublishedAt: string | null; deletedAt: string | null; updatedAt: string;
};
export type Draft = { contentId: string; revisionNumber: number; basedOnRevisionId: string | null; payload: Payload; lastSavedAt: string };
export type Revision = { id: string; contentId: string; versionNumber: number; publishedEditionNumber: number | null; revisionKind: "PUBLISHED" | "MANUAL_SNAPSHOT"; restoredFromRevisionId: string | null; payload: Payload; createdAt: string };
export type Aggregate = { state: State; draft: Draft; revisions: Revision[]; canonicalPath: string | null; aliases: string[] };
export const draftEtag = (d: Draft) => `"d-${d.contentId}-${d.revisionNumber}"`;
export const stateEtag = (s: State) => `"s-${s.id}-${s.stateVersion}"`;
export function requireMatch(actual: string, expected: string | null, code = "DRAFT_CONFLICT") {
  if (!expected) throw new DomainError(428, "PRECONDITION_REQUIRED", "请先获取最新版本");
  if (expected === "*" || expected.startsWith("W/") || !/^"[^"\r\n]+"$/.test(expected)) throw new DomainError(400, "INVALID_INPUT", "必须使用明确的强版本标识");
  if (actual !== expected) throw new DomainError(412, code, "内容已在另一处更新，请先比较最新版本");
}
export const isPublic = (s: State) => s.publicationState === "PUBLISHED" && s.effectiveVisibility === "PUBLIC" && !s.deletedAt && s.publishedRevisionId !== null;
export function createContent(type: State["type"], module: State["module"], now = new Date().toISOString()): Aggregate {
  if (type !== "ARTICLE" && module !== "LIFE") throw new DomainError(422, "INVALID_INPUT", "记录与相册只能属于生活模块");
  const id = randomUUID();
  return { state: { id, type, module, publicationState: "NEVER_PUBLISHED", effectiveVisibility: "PRIVATE", stateVersion: 1, publishedRevisionId: null, firstPublishedAt: null, lastPublishedAt: null, deletedAt: null, updatedAt: now },
    draft: { contentId: id, revisionNumber: 1, basedOnRevisionId: null, lastSavedAt: now, payload: { schemaVersion: 1, type, module, title: "", summary: "", bodyMarkdown: "", desiredVisibility: "PRIVATE", desiredPath: `/${module.toLowerCase()}/${id}`, categoryId: null, tagIds: [], coverMediaId: null, placements: [], taxonomySnapshot: { category: null, tags: [] } } },
    revisions: [], canonicalPath: null, aliases: [] };
}
function active(a: Aggregate) { if (a.state.deletedAt) throw new DomainError(409, "INVALID_INPUT", "请先从回收站恢复内容"); }
export function saveDraft(a: Aggregate, payload: Payload, expected: string | null, now = new Date().toISOString()): Aggregate {
  active(a); requireMatch(draftEtag(a.draft), expected);
  if (payload.type !== a.state.type || payload.module !== a.state.module) throw new DomainError(422, "INVALID_INPUT", "内容类型和模块不能更改");
  return { ...a, draft: { ...a.draft, payload: structuredClone(payload), revisionNumber: a.draft.revisionNumber + 1, lastSavedAt: now } };
}
function revision(a: Aggregate, kind: Revision["revisionKind"], now: string): Revision {
  return { id: randomUUID(), contentId: a.state.id, versionNumber: Math.max(0, ...a.revisions.map(r => r.versionNumber)) + 1,
    publishedEditionNumber: kind === "PUBLISHED" ? Math.max(0, ...a.revisions.map(r => r.publishedEditionNumber || 0)) + 1 : null,
    revisionKind: kind, restoredFromRevisionId: a.draft.basedOnRevisionId !== a.state.publishedRevisionId ? a.draft.basedOnRevisionId : null, payload: structuredClone(a.draft.payload), createdAt: now };
}
export function publish(a: Aggregate, draftMatch: string | null, stateMatch: string | null, now = new Date().toISOString()): Aggregate {
  active(a); requireMatch(draftEtag(a.draft), draftMatch); requireMatch(stateEtag(a.state), stateMatch, "STATE_CONFLICT");
  const p = a.draft.payload;
  if (!p.title.trim() || (p.type === "ALBUM" ? !p.placements.some(p => p.role === "ALBUM_PHOTO") : !p.bodyMarkdown.trim())) throw new DomainError(422, "INVALID_INPUT", "请补齐标题和内容后再发布");
  const r = revision(a, "PUBLISHED", now);
  return { ...a, canonicalPath: p.desiredPath, aliases: [...new Set([...a.aliases, ...(a.canonicalPath && a.canonicalPath !== p.desiredPath ? [a.canonicalPath] : [])])].filter(p => p !== a.draft.payload.desiredPath),
    state: { ...a.state, publishedRevisionId: r.id, publicationState: "PUBLISHED", effectiveVisibility: p.desiredVisibility, stateVersion: a.state.stateVersion + 1, firstPublishedAt: a.state.firstPublishedAt || now, lastPublishedAt: now, updatedAt: now },
    revisions: [...a.revisions, r], draft: { ...a.draft, basedOnRevisionId: r.id, revisionNumber: a.draft.revisionNumber + 1, lastSavedAt: now } };
}
export function snapshot(a: Aggregate, expected: string | null, now = new Date().toISOString()): Aggregate {
  active(a); requireMatch(draftEtag(a.draft), expected); return { ...a, revisions: [...a.revisions, revision(a, "MANUAL_SNAPSHOT", now)] };
}
export function restoreRevision(a: Aggregate, revisionId: string, expected: string | null, now = new Date().toISOString()): Aggregate {
  active(a); requireMatch(draftEtag(a.draft), expected);
  const r = a.revisions.find(r => r.id === revisionId); if (!r) throw new DomainError(404, "NOT_FOUND", "历史版本不存在");
  return { ...a, draft: { ...a.draft, payload: structuredClone(r.payload), basedOnRevisionId: r.id, revisionNumber: a.draft.revisionNumber + 1, lastSavedAt: now } };
}
export function changeState(a: Aggregate, action: "make-private" | "unpublish" | "trash" | "restore", expected: string | null, now = new Date().toISOString()): Aggregate {
  requireMatch(stateEtag(a.state), expected, "STATE_CONFLICT");
  if (action === "restore" ? !a.state.deletedAt : !!a.state.deletedAt) throw new DomainError(409, "INVALID_INPUT", "当前状态不允许此操作");
  if (action === "unpublish" && a.state.publicationState !== "PUBLISHED") throw new DomainError(409, "INVALID_INPUT", "内容尚未处于发布状态");
  const state = { ...a.state, effectiveVisibility: "PRIVATE" as const, stateVersion: a.state.stateVersion + 1, updatedAt: now };
  if (action === "trash") state.deletedAt = now;
  if (action === "unpublish") state.publicationState = "UNPUBLISHED";
  if (action === "restore") { state.deletedAt = null; state.publicationState = state.publishedRevisionId ? "UNPUBLISHED" : "NEVER_PUBLISHED"; }
  return { ...a, state, draft: action === "restore" ? { ...a.draft, payload: { ...a.draft.payload, desiredVisibility: "PRIVATE" }, revisionNumber: a.draft.revisionNumber + 1, lastSavedAt: now } : a.draft };
}
export const viewAdmin = (a: Aggregate) => ({ state: { ...a.state, stateEtag: stateEtag(a.state) }, draft: { ...a.draft, etag: draftEtag(a.draft) } });
export function viewPublic(a: Aggregate) {
  if (!isPublic(a.state)) throw new DomainError(404, "NOT_FOUND", "内容不存在");
  const r = a.revisions.find(r => r.id === a.state.publishedRevisionId);
  if (!r || r.revisionKind !== "PUBLISHED" || !a.canonicalPath) throw new DomainError(500, "INTERNAL_ERROR", "发布版本暂不可用");
  return { id: a.state.id, revisionId: r.id, publishedEditionNumber: r.publishedEditionNumber!, publishedAt: a.state.lastPublishedAt!, canonicalPath: a.canonicalPath, payload: structuredClone(r.payload) };
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const requestHash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
