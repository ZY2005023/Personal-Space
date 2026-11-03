import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import { createContent, DomainError } from "../src/lib/domain";
import { reconcileContentSearch } from "../src/lib/search-reconciliation";
import { runOutboxEvent } from "../src/lib/outbox-worker";
const id = "10000000-0000-4000-8000-000000000001", revisionId = "20000000-0000-4000-8000-000000000001", oldId = "20000000-0000-4000-8000-000000000002", categoryId = "30000000-0000-4000-8000-000000000001", tagId = "40000000-0000-4000-8000-000000000001";
function fixture() {
  const payload = createContent("ARTICLE", "KNOWLEDGE").draft.payload;
  payload.title = "current title"; payload.bodyMarkdown = "current body"; payload.categoryId = categoryId; payload.tagIds = [tagId];
  payload.taxonomySnapshot = { category: { id: categoryId, name: "old category", slug: "old" }, tags: [{ id: tagId, name: "old tag", slug: "old-tag" }] };
  const state = { content: { id, type: "ARTICLE", module: "KNOWLEDGE", stateVersion: 8, publicationState: "PUBLISHED", effectiveVisibility: "PUBLIC", deletedAt: null as Date | null, publishedRevisionId: revisionId as string | null, lastPublishedAt: new Date() } as null | { id: string; type: string; module: string; stateVersion: number; publicationState: string; effectiveVisibility: string; deletedAt: Date | null; publishedRevisionId: string | null; lastPublishedAt: Date }, payload, revisionExists: true, categoryExists: true, tagsExist: true, document: { title: "stale" } as Record<string, unknown> | null, event: { id, aggregateId: id, eventType: "CONTENT_STATE_CHANGED", payload: { stateVersion: 2, revisionId: oldId }, attempts: 0, leaseToken: "token", status: "PENDING", processedAt: null } as Record<string, unknown>, failAck: false, reads: [] as string[], locks: [] as string[], writes: 0 };
  const tx = {
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray) => {
      const sql = Array.isArray(query) ? query.join("") : (query as Prisma.Sql).text;
      if (sql.includes("WITH candidate")) { if (state.event.status !== "PENDING") return []; state.event.status = "RUNNING"; state.event.attempts = Number(state.event.attempts) + 1; return [{ id }]; }
      if (sql.includes("lease_until >")) return [{ id }];
      state.locks.push(sql); return [{ id }];
    },
    content: { findUnique: async (args: unknown) => { state.reads.push("content"); assert.doesNotMatch(JSON.stringify(args), /draft|include/); return structuredClone(state.content); } },
    contentRevision: { findFirst: async (args: { where: unknown }) => { state.reads.push("revision"); assert.deepEqual(args.where, { contentId: id, id: revisionId, revisionKind: "PUBLISHED" }); return state.revisionExists ? { snapshot: structuredClone(state.payload) } : null; } },
    category: { findFirst: async () => state.categoryExists ? { id: categoryId, name: "new category", slug: "new" } : null },
    tag: { findMany: async () => state.tagsExist ? [{ id: tagId, name: "new tag", slug: "new-tag" }] : [] },
    contentSearchDocument: {
      deleteMany: async () => { state.writes++; state.document = null; },
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => { state.writes++; assert.equal(create.revisionId, update.revisionId); state.document = structuredClone(create); },
    },
    outboxEvent: {
      findUniqueOrThrow: async () => structuredClone(state.event),
      update: async ({ data }: { data: Record<string, unknown> }) => { if (data.status === "PROCESSED" && state.failAck) throw new Error("ack failure"); Object.assign(state.event, data); },
    },
  };
  const client = { $transaction: async (fn: (tx: unknown) => unknown) => {
    const before = structuredClone({ document: state.document, event: state.event });
    try { return await fn(tx); } catch (error) { state.document = before.document; state.event = before.event; throw error; }
  } } as unknown as NonNullable<Parameters<typeof runOutboxEvent>[0]>;
  return { state, tx: tx as unknown as Prisma.TransactionClient, client };
}
test("stale events rebuild only the live snapshot with current taxonomy names", async () => {
  const f = fixture(); await reconcileContentSearch(f.tx, id, { stateVersion: 2, revisionId: oldId });
  assert.equal(f.state.document?.revisionId, revisionId); assert.equal(f.state.document?.title, "current title");
  assert.equal(f.state.document?.categoryText, "new category"); assert.equal(f.state.document?.tagsText, "new tag");
  assert.equal(f.state.payload.taxonomySnapshot.category?.name, "old category");
  assert.deepEqual(f.state.reads, ["content", "revision"]);
  assert.match(f.state.locks[0], /FROM contents/); assert.match(f.state.locks[1], /FROM categories/); assert.match(f.state.locks[2], /FROM tags/);
});
test("private, unpublished, deleted and absent content remove search without reading snapshots", async () => {
  for (const change of [{ effectiveVisibility: "PRIVATE" }, { publicationState: "UNPUBLISHED" }, { deletedAt: new Date() }, null]) {
    const f = fixture(); if (change) Object.assign(f.state.content!, change); else f.state.content = null;
    await reconcileContentSearch(f.tx, id, { stateVersion: 2, revisionId: oldId });
    assert.equal(f.state.document, null); assert.deepEqual(f.state.reads, ["content"]);
  }
});
test("invalid, future and same-version mismatched events cannot alter the projection", async () => {
  for (const input of [{ stateVersion: 9, revisionId }, { stateVersion: 8, revisionId: oldId }, { stateVersion: 0, revisionId }, { stateVersion: 1, revisionId: "bad" }, { stateVersion: 1, revisionId, title: "untrusted" }]) {
    const f = fixture(); await assert.rejects(() => reconcileContentSearch(f.tx, id, input), e => e instanceof DomainError && e.status === 422); assert.equal(f.state.writes, 0);
  }
});
test("incomplete live pointer, missing snapshot and mismatched payload never publish a replacement document", async () => {
  for (const mode of ["pointer", "snapshot", "type"] as const) {
    const f = fixture(); if (mode === "pointer") f.state.content!.publishedRevisionId = null; if (mode === "snapshot") f.state.revisionExists = false; if (mode === "type") f.state.content!.type = "ALBUM";
    await assert.rejects(() => reconcileContentSearch(f.tx, id, { stateVersion: 2, revisionId: oldId }), e => e instanceof DomainError && e.status === 500); assert.equal(f.state.writes, 0);
  }
});
test("missing live category or tag refuses rebuilding instead of restoring historical labels", async () => {
  for (const mode of ["category", "tag"]) {
    const f = fixture(); if (mode === "category") f.state.categoryExists = false; else f.state.tagsExist = false;
    await assert.rejects(() => reconcileContentSearch(f.tx, id, { stateVersion: 8, revisionId }), DomainError); assert.equal(f.state.writes, 0);
  }
});
test("content event acknowledgement and projection update commit together", async () => {
  const f = fixture(); await runOutboxEvent(f.client);
  assert.equal(f.state.event.status, "PROCESSED"); assert.equal(f.state.document?.revisionId, revisionId);
  assert.equal(await runOutboxEvent(f.client), false);
});
test("acknowledgement failure rolls projection back and permits replay", async () => {
  const f = fixture(); f.state.failAck = true; await runOutboxEvent(f.client);
  assert.equal(f.state.document?.title, "stale"); assert.equal(f.state.event.status, "PENDING");
  f.state.failAck = false; await runOutboxEvent(f.client); assert.equal(f.state.event.status, "PROCESSED"); assert.equal(f.state.document?.revisionId, revisionId);
});
test("content state advancing between events cannot restore an earlier document", async () => {
  const f = fixture(); await reconcileContentSearch(f.tx, id, { stateVersion: 2, revisionId: oldId });
  f.state.content!.stateVersion++; f.state.content!.effectiveVisibility = "PRIVATE";
  await reconcileContentSearch(f.tx, id, { stateVersion: 8, revisionId }); assert.equal(f.state.document, null);
});
