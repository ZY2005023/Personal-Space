import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError, parseStoredPayload, type State, type viewPublic } from "./domain";
import { decodePageCursor, finishPage } from "./pagination";
export type PublicContent = ReturnType<typeof viewPublic>;
export type PublicFilters = { module?: State["module"]; type?: State["type"]; categoryId?: string; tagId?: string; q?: string; limit?: number; cursor?: string | null };
export type PublishedRow = { id: string; type: string; module: string; publication_state: string; effective_visibility: string; deleted_at: Date | null; published_revision_id: string; revision_id: string; revision_kind: string; published_edition_number: number | null; snapshot: unknown; published_at: Date; path: string; score: number; alias?: boolean };
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
async function readRows<T>(sql: Prisma.Sql, reader?: Reader): Promise<T[]> {
  if (reader) return reader.$queryRaw<T[]>(sql);
  return db().$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`;
    return tx.$queryRaw<T[]>(sql);
  }, { timeout: 5000 });
}
export function publicationView(row: PublishedRow): PublicContent {
  if (row.publication_state !== "PUBLISHED" || row.effective_visibility !== "PUBLIC" || row.deleted_at) throw new DomainError(404, "NOT_FOUND", "内容不存在");
  if (!row.revision_id || row.revision_id !== row.published_revision_id || row.revision_kind !== "PUBLISHED" || !row.published_edition_number || !row.path) throw new DomainError(500, "INTERNAL_ERROR", "发布版本暂不可用");
  const payload = parseStoredPayload(row.snapshot);
  if (payload.type !== row.type || payload.module !== row.module) throw new DomainError(500, "INTERNAL_ERROR", "发布版本类型不一致");
  return { id: row.id, revisionId: row.revision_id, publishedEditionNumber: row.published_edition_number, publishedAt: row.published_at.toISOString(), canonicalPath: row.path, payload };
}
export function normalizedFilters(input: PublicFilters) {
  return { module: input.module || null, type: input.type || null, categoryId: input.categoryId?.toLowerCase() || null, tagId: input.tagId?.toLowerCase() || null, q: (input.q || "").normalize("NFKC").trim().toLowerCase(), sortVersion: 1 };
}
export function searchPattern(value: string) { return "%" + value.replace(/[\\%_]/g, c => "\\" + c) + "%"; }
const publicPredicate = Prisma.sql`c.publication_state = 'PUBLISHED' AND c.effective_visibility = 'PUBLIC' AND c.deleted_at IS NULL AND c.published_revision_id IS NOT NULL`;
const currentJoins = Prisma.sql`FROM contents c JOIN content_revisions r ON r.content_id = c.id AND r.id = c.published_revision_id AND r.revision_kind = 'PUBLISHED'
  JOIN content_routes canonical ON canonical.content_id = c.id AND canonical.route_kind = 'CANONICAL'`;
const columns = Prisma.sql`c.id, c.type, c.module, c.publication_state, c.effective_visibility, c.deleted_at, c.published_revision_id,
  r.id AS revision_id, r.revision_kind, r.published_edition_number, r.snapshot, c.last_published_at AS published_at, canonical.path`;
export function publishedPageQuery(input: PublicFilters) {
  const filters = normalizedFilters(input), limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
  const after = decodePageCursor(input.cursor || null, filters), pattern = searchPattern(filters.q);
  const textMatch = (field: Prisma.Sql) => Prisma.sql`${field} ILIKE ${pattern} ESCAPE '\\'`;
  const score = filters.q ? Prisma.sql`(CASE WHEN ${textMatch(Prisma.sql`d.title`)} THEN 100 ELSE 0 END + CASE WHEN ${textMatch(Prisma.sql`d.summary`)} THEN 40 ELSE 0 END + CASE WHEN ${textMatch(Prisma.sql`d.category_text`)} OR ${textMatch(Prisma.sql`d.tags_text`)} THEN 30 ELSE 0 END + CASE WHEN ${textMatch(Prisma.sql`d.searchable_text`)} THEN 10 ELSE 0 END)` : Prisma.sql`0`;
  const searchCondition = filters.q ? Prisma.sql`(${textMatch(Prisma.sql`d.title`)} OR ${textMatch(Prisma.sql`d.summary`)} OR ${textMatch(Prisma.sql`d.category_text`)} OR ${textMatch(Prisma.sql`d.tags_text`)} OR ${textMatch(Prisma.sql`d.searchable_text`)})` : Prisma.sql`TRUE`;
  const boundary = after ? Prisma.sql`(score, published_at, id) < (${after.score || 0}, ${new Date(after.publishedAt)}::timestamptz, ${after.id}::uuid)` : Prisma.sql`TRUE`;
  return { filters, limit, sql: Prisma.sql`WITH candidates AS (SELECT ${columns}, ${score} AS score ${currentJoins}
    LEFT JOIN content_search_documents d ON d.content_id = c.id AND d.revision_id = c.published_revision_id
    WHERE ${publicPredicate}
      AND ${filters.module ? Prisma.sql`c.module = ${filters.module}` : Prisma.sql`TRUE`}
      AND ${filters.type ? Prisma.sql`c.type = ${filters.type}` : Prisma.sql`TRUE`}
      AND ${filters.categoryId ? Prisma.sql`r.snapshot->>'categoryId' = ${filters.categoryId}` : Prisma.sql`TRUE`}
      AND ${filters.tagId ? Prisma.sql`(r.snapshot->'tagIds') ? ${filters.tagId}` : Prisma.sql`TRUE`}
      AND ${searchCondition}) SELECT * FROM candidates WHERE ${boundary} ORDER BY score DESC, published_at DESC, id DESC LIMIT ${limit + 1}` };
}
export async function publishedPage(input: PublicFilters = {}, reader?: Reader) {
  const query = publishedPageQuery(input);
  const rows = await readRows<PublishedRow>(query.sql, reader);
  const page = finishPage(rows.map(row => ({ ...publicationView(row), score: row.score })), query.limit, query.filters);
  return { data: page.data.map(({ score: _score, ...content }) => content), meta: page.meta };
}
export async function publishedById(id: string, reader?: Reader) {
  const rows = await readRows<PublishedRow>(Prisma.sql`SELECT ${columns}, 0 AS score ${currentJoins} WHERE ${publicPredicate} AND c.id = ${id}::uuid LIMIT 2`, reader);
  if (!rows.length) throw new DomainError(404, "NOT_FOUND", "内容不存在");
  if (rows.length !== 1) throw new DomainError(500, "INTERNAL_ERROR", "规范地址不一致");
  return publicationView(rows[0]);
}
export async function publishedByPath(path: string, reader?: Reader) {
  const rows = await readRows<PublishedRow>(Prisma.sql`SELECT ${columns}, 0 AS score, requested.route_kind = 'ALIAS' AS alias ${currentJoins}
    JOIN content_routes requested ON requested.content_id = c.id AND requested.path = ${path} AND requested.route_kind IN ('CANONICAL', 'ALIAS') WHERE ${publicPredicate} LIMIT 2`, reader);
  if (!rows.length) throw new DomainError(404, "NOT_FOUND", "内容不存在");
  if (rows.length !== 1) throw new DomainError(500, "INTERNAL_ERROR", "规范地址不一致");
  return { content: publicationView(rows[0]), alias: !!rows[0].alias };
}
export async function publicTaxonomy(kind: "categories" | "tags", reader?: Reader) {
  if (kind === "categories") return readRows<{ id: string; module: string; parentId: string | null; name: string; slug: string; sortOrder: number; isSystem: boolean; updatedAt: Date }>(Prisma.sql`
    SELECT t.id, t.module, t.parent_id AS "parentId", t.name, t.slug, t.sort_order AS "sortOrder", t.is_system AS "isSystem", t.updated_at AS "updatedAt" FROM categories t WHERE t.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM contents c JOIN content_revisions r ON r.content_id = c.id AND r.id = c.published_revision_id AND r.revision_kind = 'PUBLISHED' WHERE ${publicPredicate} AND r.snapshot->>'categoryId' = t.id::text) ORDER BY t.sort_order, t.id`, reader);
  return readRows<{ id: string; name: string; slug: string; updatedAt: Date }>(Prisma.sql`
    SELECT t.id, t.name, t.slug, t.updated_at AS "updatedAt" FROM tags t WHERE t.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM contents c JOIN content_revisions r ON r.content_id = c.id AND r.id = c.published_revision_id AND r.revision_kind = 'PUBLISHED' WHERE ${publicPredicate} AND (r.snapshot->'tagIds') ? t.id::text) ORDER BY t.created_at DESC, t.id DESC`, reader);
}
