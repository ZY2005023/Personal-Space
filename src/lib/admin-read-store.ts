import { Prisma, type Content } from "@/generated/prisma/client";
import { z } from "zod";
import { db } from "./db";
import { DomainError, draftEtag, parseStoredPayload, stateEtag, type Draft, type Revision, type State, type viewAdmin } from "./domain";
import { decodePageCursor, finishPage } from "./pagination";
import { searchPattern } from "./public-store";
export type AdminFilters = { deleted: boolean; q: string; module?: State["module"]; type?: State["type"]; categoryId?: string; tagId?: string; limit: number; cursor: string | null };
export type AdminSummary = { state: State & { stateEtag: string }; draftTitle: string; draftRevisionNumber: number };
export type AdminPage = { data: AdminSummary[]; meta: { nextCursor: string | null; hasMore: boolean } };
type StateRow = Pick<Content, "id" | "type" | "module" | "publicationState" | "effectiveVisibility" | "stateVersion" | "publishedRevisionId" | "firstPublishedAt" | "lastPublishedAt" | "deletedAt" | "updatedAt">;
export type SummaryRow = StateRow & { draftTitle: string; draftRevisionNumber: number; recentAt: Date };
export type RevisionRow = { id: string; content_id: string; version_number: number; published_edition_number: number | null; revision_kind: string; snapshot: unknown; restored_from_revision_id: string | null; created_at: Date };
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
async function readRows<T>(query: Prisma.Sql, reader?: Reader): Promise<T[]> {
  if (reader) return reader.$queryRaw<T[]>(query);
  return db().$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`;
    return tx.$queryRaw<T[]>(query);
  }, { timeout: 5000 });
}
export function adminFilters(params: URLSearchParams, defaultLimit = 20): AdminFilters {
  const get = (key: string) => { if (params.getAll(key).length > 1) throw new DomainError(400, "INVALID_INPUT", "筛选条件不能重复"); return params.get(key); };
  const deleted = get("deleted"), rawQ = get("q") || "", q = rawQ.normalize("NFKC").trim().toLowerCase();
  const module = get("module") || undefined, type = get("type") || undefined, categoryId = get("categoryId") || undefined, tagId = get("tagId") || undefined;
  const limit = Number(get("limit") ?? defaultLimit), cursor = get("cursor");
  if (deleted !== null && !["true", "false"].includes(deleted) || rawQ.includes(String.fromCharCode(0)) || rawQ.length > 100 || q.length > 100 || module && !["LIFE", "KNOWLEDGE"].includes(module) || type && !["MOMENT", "ARTICLE", "ALBUM"].includes(type) || categoryId && !z.uuid().safeParse(categoryId).success || tagId && !z.uuid().safeParse(tagId).success || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError(400, "INVALID_INPUT", "筛选或分页条件不正确");
  return { deleted: deleted === "true", q, module: module as AdminFilters["module"], type: type as AdminFilters["type"], categoryId: categoryId?.toLowerCase(), tagId: tagId?.toLowerCase(), limit, cursor };
}
const columns = Prisma.sql`c.id, c.type, c.module, c.publication_state AS "publicationState", c.effective_visibility AS "effectiveVisibility", c.state_version AS "stateVersion", c.published_revision_id AS "publishedRevisionId", c.first_published_at AS "firstPublishedAt", c.last_published_at AS "lastPublishedAt", c.deleted_at AS "deletedAt", c.updated_at AS "updatedAt"`;
function stateView(row: StateRow) {
  if (!["MOMENT", "ARTICLE", "ALBUM"].includes(row.type) || !["LIFE", "KNOWLEDGE"].includes(row.module) || !["NEVER_PUBLISHED", "PUBLISHED", "UNPUBLISHED"].includes(row.publicationState) || !["PUBLIC", "PRIVATE"].includes(row.effectiveVisibility)) throw new DomainError(500, "INTERNAL_ERROR", "内容状态记录无效");
  const state: State = { id: row.id, type: row.type as State["type"], module: row.module as State["module"], publicationState: row.publicationState as State["publicationState"], effectiveVisibility: row.effectiveVisibility as State["effectiveVisibility"], stateVersion: row.stateVersion, publishedRevisionId: row.publishedRevisionId, firstPublishedAt: row.firstPublishedAt?.toISOString() || null, lastPublishedAt: row.lastPublishedAt?.toISOString() || null, deletedAt: row.deletedAt?.toISOString() || null, updatedAt: row.updatedAt.toISOString() };
  return { ...state, stateEtag: stateEtag(state) };
}
export function adminPageQuery(adminId: string, input: AdminFilters) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
  const filters = { kind: "admin-contents", adminId, deleted: input.deleted, q: input.q, module: input.module || null, type: input.type || null, categoryId: input.categoryId || null, tagId: input.tagId || null, sortVersion: 1 };
  const after = decodePageCursor(input.cursor, filters);
  if (after && (!z.uuid().safeParse(after.id).success || after.score !== 0)) throw new DomainError(400, "INVALID_INPUT", "分页游标已失效");
  const recent = Prisma.sql`GREATEST(c.updated_at, d.last_saved_at)`;
  return { filters, sql: Prisma.sql`SELECT ${columns}, d.draft_payload->>'title' AS "draftTitle", d.revision_number AS "draftRevisionNumber", ${recent} AS "recentAt"
    FROM contents c JOIN content_drafts d ON d.content_id = c.id
    WHERE c.owner_id = ${adminId}::uuid AND ${input.deleted ? Prisma.sql`c.deleted_at IS NOT NULL` : Prisma.sql`c.deleted_at IS NULL`}
      AND ${input.module ? Prisma.sql`c.module = ${input.module}` : Prisma.sql`TRUE`}
      AND ${input.type ? Prisma.sql`c.type = ${input.type}` : Prisma.sql`TRUE`}
      AND ${input.q ? Prisma.sql`normalize(d.draft_payload->>'title', NFKC) ILIKE ${searchPattern(input.q)} ESCAPE ${String.fromCharCode(92)}` : Prisma.sql`TRUE`}
      AND ${input.categoryId ? Prisma.sql`EXISTS (SELECT 1 FROM draft_categories dc WHERE dc.content_id = c.id AND dc.category_id = ${input.categoryId}::uuid)` : Prisma.sql`TRUE`}
      AND ${input.tagId ? Prisma.sql`EXISTS (SELECT 1 FROM draft_tags dt WHERE dt.content_id = c.id AND dt.tag_id = ${input.tagId}::uuid)` : Prisma.sql`TRUE`}
      AND ${after ? Prisma.sql`(${recent}, c.id) < (${new Date(after.publishedAt)}::timestamptz, ${after.id}::uuid)` : Prisma.sql`TRUE`}
    ORDER BY ${recent} DESC, c.id DESC LIMIT ${input.limit + 1}` };
}
export async function adminPage(adminId: string, input: AdminFilters, reader?: Reader): Promise<AdminPage> {
  const query = adminPageQuery(adminId, input), rows = await readRows<SummaryRow>(query.sql, reader);
  const page = finishPage(rows.map(row => {
    if (typeof row.draftTitle !== "string" || row.draftTitle.length > 240 || !Number.isSafeInteger(row.draftRevisionNumber) || row.draftRevisionNumber < 1) throw new DomainError(500, "INTERNAL_ERROR", "草稿摘要记录无效");
    return { id: row.id, publishedAt: row.recentAt.toISOString(), state: stateView(row), draftTitle: row.draftTitle, draftRevisionNumber: row.draftRevisionNumber };
  }), input.limit, query.filters);
  return { data: page.data.map(({ id: _, publishedAt: __, ...item }) => item), meta: page.meta };
}
export async function getAdminModel(adminId: string, id: string, reader?: Reader): Promise<ReturnType<typeof viewAdmin>> {
  type Row = StateRow & { draftPayload: unknown; draftRevisionNumber: number; basedOnRevisionId: string | null; lastSavedAt: Date };
  const rows = await readRows<Row>(Prisma.sql`SELECT ${columns}, d.draft_payload AS "draftPayload", d.revision_number AS "draftRevisionNumber", d.based_on_revision_id AS "basedOnRevisionId", d.last_saved_at AS "lastSavedAt"
    FROM contents c LEFT JOIN content_drafts d ON d.content_id = c.id WHERE c.id = ${id}::uuid AND c.owner_id = ${adminId}::uuid LIMIT 1`, reader);
  if (!rows.length) throw new DomainError(404, "NOT_FOUND", "内容不存在");
  const row = rows[0], payload = parseStoredPayload(row.draftPayload);
  if (payload.type !== row.type || payload.module !== row.module) throw new DomainError(500, "INTERNAL_ERROR", "草稿与内容类型不一致");
  const draft: Draft = { contentId: row.id, revisionNumber: row.draftRevisionNumber, basedOnRevisionId: row.basedOnRevisionId, payload, lastSavedAt: row.lastSavedAt.toISOString() };
  return { state: stateView(row), draft: { ...draft, etag: draftEtag(draft) } };
}
export async function getAdminState(adminId: string, id: string, reader?: Reader) {
  const rows = await readRows<StateRow>(Prisma.sql`SELECT ${columns} FROM contents c WHERE c.id = ${id}::uuid AND c.owner_id = ${adminId}::uuid LIMIT 1`, reader);
  if (!rows.length) throw new DomainError(404, "NOT_FOUND", "内容不存在"); return stateView(rows[0]);
}
function revisionView(row: RevisionRow): Revision {
  if (!["PUBLISHED", "MANUAL_SNAPSHOT"].includes(row.revision_kind) || !Number.isSafeInteger(row.version_number) || row.version_number < 1) throw new DomainError(500, "INTERNAL_ERROR", "历史版本记录无效");
  return { id: row.id, contentId: row.content_id, versionNumber: row.version_number, publishedEditionNumber: row.published_edition_number, revisionKind: row.revision_kind as Revision["revisionKind"], restoredFromRevisionId: row.restored_from_revision_id, payload: parseStoredPayload(row.snapshot), createdAt: row.created_at.toISOString() };
}
export function revisionsQuery(adminId: string, contentId: string, limit: number, cursor: string | null) {
  const filters = { kind: "admin-revisions", adminId, contentId, sortVersion: 1 }, after = decodePageCursor(cursor, filters);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || after && (!z.uuid().safeParse(after.id).success || !after.score || after.score < 1)) throw new DomainError(400, "INVALID_INPUT", "历史分页条件不正确");
  return { filters, sql: Prisma.sql`SELECT r.* FROM content_revisions r JOIN contents c ON c.id = r.content_id
    WHERE c.id = ${contentId}::uuid AND c.owner_id = ${adminId}::uuid AND ${after ? Prisma.sql`r.version_number < ${after.score}` : Prisma.sql`TRUE`}
    ORDER BY r.version_number DESC LIMIT ${limit + 1}` };
}
export async function revisionPage(adminId: string, contentId: string, limit = 10, cursor: string | null = null, reader?: Reader) {
  const query = revisionsQuery(adminId, contentId, limit, cursor);
  const owner = await readRows<{ id: string }>(Prisma.sql`SELECT id FROM contents WHERE id = ${contentId}::uuid AND owner_id = ${adminId}::uuid LIMIT 1`, reader);
  if (!owner.length) throw new DomainError(404, "NOT_FOUND", "内容不存在");
  const rows = await readRows<RevisionRow>(query.sql, reader);
  const page = finishPage(rows.map(row => ({ ...revisionView(row), publishedAt: row.created_at.toISOString(), score: row.version_number })), limit, query.filters);
  return { data: page.data.map(({ publishedAt: _, score: __, ...item }) => item), meta: page.meta };
}
export async function getRevision(adminId: string, contentId: string, revisionId: string, reader?: Reader) {
  const rows = await readRows<RevisionRow>(Prisma.sql`SELECT r.* FROM content_revisions r JOIN contents c ON c.id = r.content_id
    WHERE c.id = ${contentId}::uuid AND c.owner_id = ${adminId}::uuid AND r.id = ${revisionId}::uuid LIMIT 1`, reader);
  if (!rows.length) throw new DomainError(404, "NOT_FOUND", "版本不存在"); return revisionView(rows[0]);
}
export async function adminCounts(adminId: string, reader?: Reader) {
  const [counts] = await readRows<{ public: bigint; pending: bigint; albums: bigint }>(Prisma.sql`SELECT
    COUNT(*) FILTER (WHERE c.publication_state = 'PUBLISHED' AND c.effective_visibility = 'PUBLIC' AND r.id IS NOT NULL AND r.revision_kind = 'PUBLISHED') AS public,
    COUNT(*) FILTER (WHERE c.publication_state <> 'PUBLISHED' OR r.id IS NULL OR r.revision_kind <> 'PUBLISHED' OR d.based_on_revision_id IS DISTINCT FROM c.published_revision_id OR (d.draft_payload - 'taxonomySnapshot') IS DISTINCT FROM (r.snapshot - 'taxonomySnapshot')) AS pending,
    COUNT(*) FILTER (WHERE c.type = 'ALBUM') AS albums
    FROM contents c JOIN content_drafts d ON d.content_id = c.id LEFT JOIN content_revisions r ON r.id = c.published_revision_id AND r.content_id = c.id
    WHERE c.owner_id = ${adminId}::uuid AND c.deleted_at IS NULL`, reader);
  const result = { public: Number(counts.public), pending: Number(counts.pending), albums: Number(counts.albums) };
  if (Object.values(result).some(n => !Number.isSafeInteger(n) || n < 0)) throw new DomainError(500, "INTERNAL_ERROR", "概览计数无效"); return result;
}
