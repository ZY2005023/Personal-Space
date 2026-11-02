import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import { createContent, DomainError } from "../src/lib/domain";
import { publishedById, publishedByPath, publishedPage, publishedPageQuery, publicationView, searchPattern, type PublishedRow } from "../src/lib/public-store";
import { decodePageCursor, finishPage, paginate } from "../src/lib/pagination";
function row(): PublishedRow {
  const a = createContent("ARTICLE", "KNOWLEDGE"); a.draft.payload.title = "正式标题"; a.draft.payload.bodyMarkdown = "正式正文";
  return { id: a.state.id, type: "ARTICLE", module: "KNOWLEDGE", publication_state: "PUBLISHED", effective_visibility: "PUBLIC", deleted_at: null, published_revision_id: "20000000-0000-4000-8000-000000000001", revision_id: "20000000-0000-4000-8000-000000000001", revision_kind: "PUBLISHED", published_edition_number: 1, snapshot: a.draft.payload, published_at: new Date("2026-11-02T04:00:00.000Z"), path: "/knowledge/notes", score: 0 };
}
function reader(rows: PublishedRow[]) {
  const calls: Prisma.Sql[] = [];
  return { calls, $queryRaw: async <T>(q: Prisma.Sql) => { calls.push(q); return rows as T; } } as unknown as Pick<Prisma.TransactionClient, "$queryRaw"> & { calls: Prisma.Sql[] };
}
test("public SQL reads only the current snapshot and enforces the live permission predicate", () => {
  const q = publishedPageQuery({ module: "KNOWLEDGE", q: "笔记", limit: 10 }).sql.text;
  assert.doesNotMatch(q, /content_drafts|draft_payload|password_hash|storage_key/); assert.match(q, /r.id = c.published_revision_id/); assert.match(q, /d.revision_id = c.published_revision_id/); assert.match(q, /c.effective_visibility = 'PUBLIC'/); assert.match(q, /c.deleted_at IS NULL/); assert.match(q, /ORDER BY score DESC, published_at DESC, id DESC LIMIT/);
});
test("query parameters are bound and wildcard characters remain literal search input", () => {
  const input = "%' OR TRUE; --_\\"; const query = publishedPageQuery({ q: input }); assert.doesNotMatch(query.sql.text, /OR TRUE; --/); assert.ok(query.sql.values.some(v => v === searchPattern(input.toLowerCase()))); assert.equal(searchPattern("a%b_c\\"), "%a\\%b\\_c\\\\%");
});
test("detail-by-ID performs a bounded single-item query instead of listing public contents", async () => {
  const data = row(), fake = reader([data]); const result = await publishedById(data.id, fake);
  assert.equal(result.payload.title, "正式标题"); assert.equal(fake.calls.length, 1); assert.match(fake.calls[0].text, /c.id = \$\d+::uuid LIMIT 2/); assert.ok(fake.calls[0].values.includes(data.id));
});
test("private, withdrawn and trashed results are refused even if an adapter incorrectly returns them", () => {
  for (const change of [{ effective_visibility: "PRIVATE" }, { publication_state: "UNPUBLISHED" }, { deleted_at: new Date() }]) assert.throws(() => publicationView({ ...row(), ...change }), e => e instanceof DomainError && e.status === 404);
});
test("mismatched current pointers and manual snapshots cannot become public responses", () => {
  const value = row(); assert.throws(() => publicationView({ ...value, revision_id: "different" }), DomainError); assert.throws(() => publicationView({ ...value, revision_kind: "MANUAL_SNAPSHOT" }), DomainError);
});
test("historical paths check permission before exposing canonical redirect information", async () => {
  const value = row(); const allowed = await publishedByPath("/knowledge/old", reader([{ ...value, alias: true }])); assert.equal(allowed.alias, true); assert.equal(allowed.content.canonicalPath, value.path);
  await assert.rejects(() => publishedByPath("/knowledge/old", reader([{ ...value, alias: true, effective_visibility: "PRIVATE" }])), e => e instanceof DomainError && e.status === 404);
});
test("database page consumes at most limit plus one and binds a ranked keyset cursor", async () => {
  const first = row(), second = { ...row(), published_at: new Date("2026-11-01T04:00:00.000Z") }; const fake = reader([first, second]);
  const page = await publishedPage({ limit: 1 }, fake); assert.equal(page.data.length, 1); assert.equal(page.meta.hasMore, true); assert.equal((page.data[0] as unknown as { score?: number }).score, undefined); assert.ok(fake.calls[0].values.includes(2));
  const next = publishedPageQuery({ limit: 1, cursor: page.meta.nextCursor }); assert.match(next.sql.text, /\(score, published_at, id\) </);
});
test("ranked pagination preserves relevance before time and cannot reuse a different query", () => {
  const items = [{ id: "old-title", publishedAt: "2026-10-01T00:00:00.000Z", score: 100 }, { id: "new-body", publishedAt: "2026-11-01T00:00:00.000Z", score: 10 }];
  const page = paginate(items, 1, null, { q: "笔记" }); assert.equal(page.data[0].id, "old-title"); assert.equal(decodePageCursor(page.meta.nextCursor, { q: "笔记" })?.score, 100); assert.throws(() => decodePageCursor(page.meta.nextCursor, { q: "相册" })); assert.equal(paginate(items, 1, page.meta.nextCursor, { q: "笔记" }).data[0].id, "new-body");
});
