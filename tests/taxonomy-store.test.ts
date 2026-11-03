import { test } from "node:test";
import assert from "node:assert/strict";
import { writeTaxonomy } from "../src/lib/taxonomy-store";
import { taxonomyEtag } from "../src/lib/taxonomy";
import { DomainError } from "../src/lib/domain";
const adminId = "10000000-0000-4000-8000-000000000001", id = "20000000-0000-4000-8000-000000000001";
const row = { id, name: "旅行", slug: "travel", updatedAt: new Date("2026-11-02T12:00:00Z") };
function fixture() {
  const calls: string[] = []; let saved: unknown = null, references = 0;
  const tx = {
    $queryRaw: async () => { calls.push("lock"); return []; },
    idempotencyRecord: { findUnique: async () => saved, delete: async () => {}, create: async ({ data }: { data: unknown }) => { saved = data; } },
    tag: { findFirst: async () => row, create: async () => { calls.push("create"); return row; }, update: async () => { calls.push("update"); return row; } },
    draftTag: { count: async () => references }, revisionTag: { count: async () => 0 }, contentTag: { count: async () => 0 },
    auditLog: { create: async () => { calls.push("audit"); } },
  };
  const client = { $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as Parameters<typeof writeTaxonomy>[1];
  return { client, calls, reference: () => { references = 1; } };
}
test("catalog create retry returns the original response without a second write or audit", async () => {
  const f = fixture(), options = { kind: "tags" as const, adminId, method: "POST", body: { name: "旅行", slug: "travel" }, match: null, key: "idempotency-key-0001" };
  const first = await writeTaxonomy(options, f.client), second = await writeTaxonomy(options, f.client);
  assert.deepEqual(second, first); assert.equal(first.status, 201); assert.equal(f.calls.filter(c => c === "create").length, 1); assert.equal(f.calls.filter(c => c === "audit").length, 1);
  await assert.rejects(writeTaxonomy({ ...options, body: { name: "其他", slug: "other" } }, f.client), e => e instanceof DomainError && e.code === "IDEMPOTENCY_MISMATCH");
});
test("stale catalog update and referenced deletion produce no writes or audit", async () => {
  const f = fixture();
  await assert.rejects(writeTaxonomy({ kind: "tags", adminId, id, method: "PUT", body: { name: "新名称", slug: "travel" }, match: '"old"' }, f.client), e => e instanceof DomainError && e.status === 412);
  f.reference();
  await assert.rejects(writeTaxonomy({ kind: "tags", adminId, id, method: "DELETE", body: null, match: taxonomyEtag(JSON.parse(JSON.stringify(row))), key: "idempotency-key-delete" }, f.client), e => e instanceof DomainError && e.code === "RESOURCE_REFERENCED");
  assert.equal(f.calls.includes("update"), false); assert.equal(f.calls.includes("audit"), false);
});
test("unreferenced deletion uses a bodyless success and retries are replayable", async () => {
  const f = fixture(), options = { kind: "tags" as const, adminId, id, method: "DELETE", body: null, match: taxonomyEtag(JSON.parse(JSON.stringify(row))), key: "idempotency-key-delete" };
  assert.deepEqual(await writeTaxonomy(options, f.client), { data: null, etag: "", status: 204 });
  assert.deepEqual(await writeTaxonomy(options, f.client), { data: null, etag: "", status: 204 });
  assert.equal(f.calls.filter(c => c === "update").length, 1);
});
