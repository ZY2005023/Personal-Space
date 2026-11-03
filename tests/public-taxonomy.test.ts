import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import { DomainError } from "../src/lib/domain";
import { publicTaxonomy, publicTaxonomyQuery } from "../src/lib/public-store";
import { finishPage } from "../src/lib/pagination";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = new Date("2026-11-03T01:00:00.000Z");
function reader(rows: unknown[]) {
  const calls: Prisma.Sql[] = [];
  return { calls, $queryRaw: async <T>(sql: Prisma.Sql) => { calls.push(sql); return rows as T; } } as Pick<Prisma.TransactionClient, "$queryRaw"> & { calls: Prisma.Sql[] };
}
const category = (n: number, sortOrder: number) => ({ id: id(n), module: "LIFE", parentId: null, name: "category", slug: `category-${n}`, sortOrder, isSystem: false, updatedAt: date });
test("public taxonomy queries bound page size and enforce current public references", () => {
  for (const kind of ["categories", "tags"] as const) {
    const q = publicTaxonomyQuery(kind, { limit: 3 });
    assert.equal(q.sql.values.at(-1), 4);
    assert.match(q.sql.text, /t.deleted_at IS NULL/);
    assert.match(q.sql.text, /c.effective_visibility = 'PUBLIC'/);
    assert.match(q.sql.text, /c.deleted_at IS NULL/);
    assert.match(q.sql.text, /r.id = c.published_revision_id/);
    assert.doesNotMatch(q.sql.text, /content_drafts|snapshot AS|OFFSET/);
  }
});
test("category cursor preserves signed sort values and same-sort UUID ascending boundary", async () => {
  for (const sort of [-2147483648, -1, 0, 2147483647]) {
    const page = await publicTaxonomy("categories", { limit: 1 }, reader([category(1, sort), category(2, sort)]));
    assert.equal(page.data.length, 1); assert.equal(page.meta.hasMore, true);
    const next = publicTaxonomyQuery("categories", { limit: 2, cursor: page.meta.nextCursor });
    assert.match(next.sql.text, /\(t.sort_order, t.id\) > /);
    assert.ok(next.sql.values.includes(sort)); assert.ok(next.sql.values.includes(id(1)));
    assert.deepEqual(Object.keys(page.data[0]).sort(), Object.keys(category(1, sort)).sort());
    const last = await publicTaxonomy("categories", { limit: 2, cursor: page.meta.nextCursor }, reader([category(2, sort)]));
    assert.equal(last.meta.nextCursor, null); assert.equal(last.meta.hasMore, false);
  }
});
test("tag cursor uses creation time rather than rename time and hides internal ordering fields", async () => {
  const tag = (n: number) => ({ id: id(n), name: "tag", slug: `tag-${n}`, updatedAt: new Date("2026-11-04T01:00:00.000Z"), createdAt: date });
  const page = await publicTaxonomy("tags", { limit: 1 }, reader([tag(2), tag(1)]));
  assert.deepEqual(Object.keys(page.data[0]).sort(), ["id", "name", "slug", "updatedAt"]);
  const next = publicTaxonomyQuery("tags", { cursor: page.meta.nextCursor });
  assert.match(next.sql.text, /\(t.created_at, t.id\) < /);
  assert.ok(next.sql.values.some(v => v instanceof Date && v.toISOString() === date.toISOString()));
  assert.ok(next.sql.values.includes(id(2)));
});
test("directory cursors reject tampering, cross-kind reuse and invalid key shapes before SQL", async () => {
  const query = publicTaxonomyQuery("categories");
  const cursor = finishPage([{ id: id(1), publishedAt: "1970-01-01T00:00:00.000Z", score: 0 }, { id: id(2), publishedAt: "1970-01-01T00:00:00.000Z", score: 0 }], 1, query.filters).meta.nextCursor!;
  for (const [kind, value] of [["categories", cursor + "x"], ["tags", cursor]] as const) assert.throws(() => publicTaxonomyQuery(kind, { cursor: value }), e => e instanceof DomainError && e.status === 400);
  for (const change of [{ id: "bad" }, { score: 4294967296 }, { publishedAt: date.toISOString() }]) {
    const bad = finishPage([{ id: id(1), publishedAt: "1970-01-01T00:00:00.000Z", score: 0, ...change }, { id: id(2), publishedAt: date.toISOString() }], 1, query.filters).meta.nextCursor;
    assert.throws(() => publicTaxonomyQuery("categories", { cursor: bad }), DomainError);
  }
});
test("empty pages terminate and invalid limits never reach the reader", async () => {
  for (const kind of ["categories", "tags"] as const) {
    assert.deepEqual(await publicTaxonomy(kind, {}, reader([])), { data: [], meta: { nextCursor: null, hasMore: false } });
    for (const limit of [0, -1, 101, 1.5, NaN]) {
      const fake = reader([]); await assert.rejects(() => publicTaxonomy(kind, { limit }, fake), DomainError); assert.equal(fake.calls.length, 0);
    }
  }
});
test("invalid persisted category ordering cannot generate misleading cursors", async () => {
  await assert.rejects(() => publicTaxonomy("categories", {}, reader([category(1, 2147483648)])), e => e instanceof DomainError && e.status === 500);
});
