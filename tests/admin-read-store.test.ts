import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import { adminCounts, adminFilters, adminPage, adminPageQuery, getAdminModel, getAdminState, getRevision, revisionPage, revisionsQuery, type SummaryRow, type RevisionRow } from "../src/lib/admin-read-store";
import { createContent, DomainError, viewAdmin } from "../src/lib/domain";
const adminId = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const a = createContent("ARTICLE", "KNOWLEDGE", "2026-11-03T02:00:00.000Z");
function row(id = a.state.id): SummaryRow {
  return { ...a.state, id, firstPublishedAt: null, lastPublishedAt: null, deletedAt: null, updatedAt: new Date(a.state.updatedAt), draftTitle: "草稿标题", draftRevisionNumber: 4, recentAt: new Date("2026-11-03T03:00:00.000Z") };
}
function reader(results: unknown[][]) {
  const calls: Prisma.Sql[] = [];
  return { calls, $queryRaw: async (q: Prisma.Sql) => { calls.push(q); return results[Math.min(calls.length - 1, results.length - 1)]; } } as unknown as Pick<Prisma.TransactionClient, "$queryRaw"> & { calls: Prisma.Sql[] };
}
const filters = (query = "") => adminFilters(new URLSearchParams(query));
function revision(version: number): RevisionRow { return { id: `20000000-0000-4000-8000-${String(version).padStart(12, "0")}`, content_id: a.state.id, version_number: version, published_edition_number: null, revision_kind: "MANUAL_SNAPSHOT", snapshot: a.draft.payload, restored_from_revision_id: null, created_at: new Date(`2026-11-0${version % 3 + 1}T02:00:00.000Z`) }; }
test("admin filters normalize queries and reject malformed, duplicate or oversized parameters", () => {
  assert.equal(filters("q=%EF%BC%A1%EF%BC%A9&deleted=true&type=ARTICLE&module=KNOWLEDGE").q, "ai");
  for (const query of ["deleted=yes", "limit=0", "limit=101", "limit=1.5", "module=unknown", "type=unknown", "categoryId=invalid", "tagId=invalid", "q=one&q=two", "q=%00", "q=" + " ".repeat(101)]) assert.throws(() => filters(query), e => e instanceof DomainError && e.status === 400);
});
test("admin list projects only summaries, binds ownership and draft reference filters, and bounds SQL", () => {
  const query = adminPageQuery(adminId, filters("limit=2&categoryId=" + other + "&tagId=" + other));
  assert.match(query.sql.text, /c.owner_id = \$[0-9]+::uuid/); assert.ok(query.sql.values.includes(adminId)); assert.ok(query.sql.values.includes(3));
  assert.match(query.sql.text, /draft_categories/); assert.match(query.sql.text, /draft_tags/); assert.match(query.sql.text, /GREATEST\(c.updated_at, d.last_saved_at\)/);
  assert.doesNotMatch(query.sql.text, /SELECT \*|content_revisions|snapshot|bodyMarkdown|storage_key|password_hash/);
});
test("title filters bind escaped literal wildcards rather than injecting SQL", () => {
  const input = "%' OR TRUE; --_", query = adminPageQuery(adminId, filters("q=" + encodeURIComponent(input)));
  assert.doesNotMatch(query.sql.text, /OR TRUE; --/); assert.ok(query.sql.values.includes("%\\%' or true; --\\_%")); assert.ok(query.sql.values.includes(String.fromCharCode(92))); assert.match(query.sql.text, /ESCAPE \$[0-9]+/);
});
test("list cursors use latest draft activity and bind administrator, filters and recycle-bin scope", async () => {
  const rows = [row("30000000-0000-4000-8000-000000000003"), row("30000000-0000-4000-8000-000000000002"), row("30000000-0000-4000-8000-000000000001")];
  const fake = reader([rows]), page = await adminPage(adminId, filters("limit=2"), fake);
  assert.equal(page.data.length, 2); assert.equal(page.meta.hasMore, true); assert.equal(page.data[0].state.updatedAt, a.state.updatedAt); assert.equal(page.data[0].state.stateEtag, viewAdmin(a).state.stateEtag.replace(a.state.id, rows[0].id));
  const next = filters("limit=2&cursor=" + encodeURIComponent(page.meta.nextCursor!)), query = adminPageQuery(adminId, next);
  assert.match(query.sql.text, /< \(\$[0-9]+::timestamptz, \$[0-9]+::uuid\)/); assert.ok(query.sql.values.some(v => v instanceof Date && v.toISOString() === rows[1].recentAt.toISOString()));
  assert.throws(() => adminPageQuery(other, next), DomainError); assert.throws(() => adminPageQuery(adminId, { ...next, deleted: true }), DomainError); assert.throws(() => adminPageQuery(adminId, { ...next, q: "changed" }), DomainError);
  assert.doesNotMatch(JSON.stringify(page), /recentAt|publishedAt|snapshot|draftPayload/);
});
test("editor and state reads are owned single-item queries that never load history", async () => {
  const raw = { ...row(), draftPayload: a.draft.payload, draftRevisionNumber: 1, basedOnRevisionId: null, lastSavedAt: new Date(a.draft.lastSavedAt) }, fake = reader([[raw]]);
  const model = await getAdminModel(adminId, a.state.id, fake); assert.deepEqual(model, viewAdmin(a));
  assert.match(fake.calls[0].text, /LIMIT 1/); assert.doesNotMatch(fake.calls[0].text, /content_revisions|content_routes/);
  const stateReader = reader([[raw]]); assert.deepEqual(await getAdminState(adminId, a.state.id, stateReader), model.state); assert.doesNotMatch(stateReader.calls[0].text, /content_drafts|draft_payload|content_revisions/);
});
test("missing owned contents and mismatched stored draft types fail instead of returning a model", async () => {
  await assert.rejects(getAdminModel(adminId, a.state.id, reader([[]])), e => e instanceof DomainError && e.status === 404);
  const raw = { ...row(), type: "MOMENT", draftPayload: a.draft.payload, basedOnRevisionId: null, lastSavedAt: new Date() };
  await assert.rejects(getAdminModel(adminId, a.state.id, reader([[raw]])), e => e instanceof DomainError && e.status === 500);
});
test("history paginates by immutable version number even if creation timestamps are not monotonic", async () => {
  const fake = reader([[{ id: a.state.id }], [revision(8), revision(7), revision(6)]]), page = await revisionPage(adminId, a.state.id, 2, null, fake);
  assert.deepEqual(page.data.map(r => r.versionNumber), [8, 7]); assert.equal(page.meta.hasMore, true); assert.ok(fake.calls[1].values.includes(3));
  const next = revisionsQuery(adminId, a.state.id, 2, page.meta.nextCursor); assert.match(next.sql.text, /r.version_number < \$[0-9]+/); assert.ok(next.sql.values.includes(7));
  assert.throws(() => revisionsQuery(adminId, other, 2, page.meta.nextCursor), DomainError); assert.throws(() => revisionsQuery(other, a.state.id, 2, page.meta.nextCursor), DomainError);
  assert.doesNotMatch(JSON.stringify(page), /"score"|"publishedAt"/);
});
test("history distinguishes empty existing content from missing or non-owned content", async () => {
  const empty = await revisionPage(adminId, a.state.id, 10, null, reader([[{ id: a.state.id }], []])); assert.deepEqual(empty, { data: [], meta: { nextCursor: null, hasMore: false } });
  await assert.rejects(revisionPage(adminId, a.state.id, 10, null, reader([[]])), e => e instanceof DomainError && e.status === 404);
});
test("single historical revision reads bind both content and revision IDs with owner scope", async () => {
  const r = revision(8), fake = reader([[r]]); const result = await getRevision(adminId, a.state.id, r.id, fake);
  assert.equal(result.versionNumber, 8); assert.equal(fake.calls.length, 1); assert.deepEqual(fake.calls[0].values, [a.state.id, adminId, r.id]); assert.match(fake.calls[0].text, /LIMIT 1/);
  await assert.rejects(getRevision(adminId, a.state.id, r.id, reader([[]])), e => e instanceof DomainError && e.status === 404);
});
test("dashboard counts aggregate in SQL and compare complete editable payloads, not just titles", async () => {
  const fake = reader([[{ public: 4n, pending: 2n, albums: 1n }]]); assert.deepEqual(await adminCounts(adminId, fake), { public: 4, pending: 2, albums: 1 });
  assert.match(fake.calls[0].text, /COUNT\(\*\) FILTER/); assert.match(fake.calls[0].text, /r.revision_kind = 'PUBLISHED'/); assert.match(fake.calls[0].text, /d.draft_payload - 'taxonomySnapshot'/); assert.match(fake.calls[0].text, /c.deleted_at IS NULL/); assert.ok(fake.calls[0].values.includes(adminId));
});
