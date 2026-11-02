import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import { changeState, createContent, draftEtag, publish, saveDraft, snapshot, stateEtag, type Payload } from "../src/lib/domain";
import { persistAggregate } from "../src/lib/content-store";
import { assertMediaCanDelete, assertTaxonomyCanDelete } from "../src/lib/reference-store";
const admin = "10000000-0000-4000-8000-000000000001", mediaId = "20000000-0000-4000-8000-000000000001", categoryId = "30000000-0000-4000-8000-000000000001", tagId = "40000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
function harness() {
  const tables: Record<string, Row[]> = { category: [{ id: categoryId, module: "LIFE", name: "旅行", slug: "travel", deletedAt: null }], tag: [{ id: tagId, name: "旧标签", slug: "tag", deletedAt: null }], media: [{ id: mediaId, uploadedBy: admin, processingStatus: "READY", deletedAt: null }] };
  const writes: string[] = [], locks: Prisma.Sql[] = []; const api: Record<string, unknown> = { $queryRaw: async (sql: Prisma.Sql) => { locks.push(sql); return []; } };
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, value]) => value && typeof value === "object" && "in" in value ? (value as { in: unknown[] }).in.includes(row[k]) : row[k] === value);
  for (const name of ["content", "contentDraft", "contentRevision", "contentPublication", "contentRoute", "draftMedia", "revisionMedia", "contentMedia", "draftCategory", "revisionCategory", "draftTag", "revisionTag", "contentTag", "contentSearchDocument", "outboxEvent", "category", "tag", "media"]) {
    tables[name] ||= [];
    api[name] = {
      findMany: async ({ where = {} }: { where?: Row }) => tables[name].filter(r => matches(r, where)),
      findUnique: async ({ where }: { where: Row }) => tables[name].find(r => matches(r, where)) || null,
      findFirst: async ({ where }: { where: Row }) => tables[name].find(r => matches(r, where)) || null,
      count: async ({ where }: { where: Row }) => tables[name].filter(r => matches(r, where)).length,
      create: async ({ data }: { data: Row }) => { writes.push(name + ".create"); tables[name].push(structuredClone(data)); return data; },
      createMany: async ({ data }: { data: Row[] }) => { writes.push(name + ".createMany"); tables[name].push(...structuredClone(data)); return { count: data.length }; },
      deleteMany: async ({ where }: { where: Row }) => { writes.push(name + ".deleteMany"); tables[name] = tables[name].filter(r => !matches(r, where)); return {}; },
      update: async ({ where, data }: { where: Row; data: Row }) => { writes.push(name + ".update"); const row = tables[name].find(r => matches(r, where)); if (!row) throw new Error("fixture row missing"); Object.assign(row, structuredClone(data)); return row; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { writes.push(name + ".updateMany"); for (const row of tables[name].filter(r => matches(r, where))) Object.assign(row, structuredClone(data)); return {}; },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => { writes.push(name + ".upsert"); const row = tables[name].find(r => matches(r, where)); if (row) { Object.assign(row, structuredClone(update)); return row; } tables[name].push(structuredClone(create)); return create; },
    };
  }
  return { tx: api as unknown as Prisma.TransactionClient, tables, writes, locks };
}
function albumPayload(base: Payload): Payload { return { ...base, title: "相册", desiredVisibility: "PUBLIC", categoryId, tagIds: [tagId], placements: [1, 2].map(n => ({ placementId: `50000000-0000-4000-8000-00000000000${n}`, mediaId, role: "ALBUM_PHOTO", caption: "说明" + n, altText: "山" + n })) }; }
test("save, publish and later editing keep three reference layers independent", async () => {
  const h = harness(), empty = await persistAggregate(h.tx, createContent("ALBUM", "LIFE"), admin, null, "create");
  const draft = await persistAggregate(h.tx, saveDraft(empty, albumPayload(empty.draft.payload), draftEtag(empty.draft)), admin, empty, "save");
  assert.equal(h.tables.draftMedia.length, 2); assert.equal(h.tables.revisionMedia.length, 0); assert.equal(h.tables.contentMedia.length, 0); assert.equal(draft.draft.payload.taxonomySnapshot.tags[0].name, "旧标签");
  const live = await persistAggregate(h.tx, publish(draft, draftEtag(draft.draft), stateEtag(draft.state)), admin, draft, "publish");
  assert.equal(h.tables.revisionMedia.length, 2); assert.equal(h.tables.contentMedia.length, 2); assert.equal(h.tables.revisionCategory.length, 1); assert.equal(h.tables.contentTag.length, 1); assert.equal(h.tables.contentSearchDocument.length, 1);
  const oldProjection = structuredClone(h.tables.contentPublication); h.writes.length = 0;
  await persistAggregate(h.tx, saveDraft(live, { ...live.draft.payload, title: "未发布", placements: [], categoryId: null, tagIds: [] }, draftEtag(live.draft)), admin, live, "save");
  assert.equal(h.tables.draftMedia.length, 0); assert.equal(h.tables.revisionMedia.length, 2); assert.equal(h.tables.contentMedia.length, 2); assert.deepEqual(h.tables.contentPublication, oldProjection); assert.equal(h.tables.contentSearchDocument[0].title, "相册"); assert.equal(h.writes.some(w => /revisionMedia\.(delete|update)|contentPublication\.upsert/.test(w)), false);
  await assert.rejects(() => assertMediaCanDelete(h.tx, mediaId)); await assert.rejects(() => assertTaxonomyCanDelete(h.tx, "tag", tagId));
});
test("non-ready publication fails before writing snapshots or a published pointer", async () => {
  const h = harness(); h.tables.media[0].processingStatus = "PROCESSING";
  const empty = await persistAggregate(h.tx, createContent("ALBUM", "LIFE"), admin, null, "create");
  const draft = await persistAggregate(h.tx, saveDraft(empty, albumPayload(empty.draft.payload), draftEtag(empty.draft)), admin, empty, "save"); h.writes.length = 0;
  await assert.rejects(() => persistAggregate(h.tx, publish(draft, draftEtag(draft.draft), stateEtag(draft.state)), admin, draft, "publish")); assert.equal(h.tables.contentRevision.length, 0); assert.deepEqual(h.writes, []);
});
test("making a content private succeeds even if an already-referenced media becomes unavailable", async () => {
  const h = harness(), empty = await persistAggregate(h.tx, createContent("ALBUM", "LIFE"), admin, null, "create");
  const draft = await persistAggregate(h.tx, saveDraft(empty, albumPayload(empty.draft.payload), draftEtag(empty.draft)), admin, empty, "save");
  const live = await persistAggregate(h.tx, publish(draft, draftEtag(draft.draft), stateEtag(draft.state)), admin, draft, "publish"); h.tables.media[0].processingStatus = "FAILED";
  const privateItem = await persistAggregate(h.tx, changeState(live, "make-private", stateEtag(live.state)), admin, live, "state");
  assert.equal(privateItem.state.effectiveVisibility, "PRIVATE"); assert.equal(h.tables.contentSearchDocument.length, 0); assert.equal(h.tables.revisionMedia.length, 2); assert.equal(h.tables.contentMedia.length, 2); assert.equal(privateItem.state.publishedRevisionId, live.state.publishedRevisionId);
});
test("new snapshots capture current labels without rewriting prior immutable snapshots", async () => {
  const h = harness(), empty = await persistAggregate(h.tx, createContent("ALBUM", "LIFE"), admin, null, "create");
  const draft = await persistAggregate(h.tx, saveDraft(empty, albumPayload(empty.draft.payload), draftEtag(empty.draft)), admin, empty, "save");
  const old = await persistAggregate(h.tx, snapshot(draft, draftEtag(draft.draft)), admin, draft, "snapshot"); h.tables.tag[0].name = "新标签";
  const next = await persistAggregate(h.tx, snapshot(old, draftEtag(old.draft)), admin, old, "snapshot");
  assert.equal(next.revisions[0].payload.taxonomySnapshot.tags[0].name, "旧标签"); assert.equal(next.revisions[1].payload.taxonomySnapshot.tags[0].name, "新标签"); assert.equal(h.tables.revisionTag.length, 2);
});
