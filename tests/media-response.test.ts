import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../src/generated/prisma/client";
import { publicImage, publicImageQuery } from "../src/lib/media-response";
import { checksum, type ObjectStore } from "../src/lib/object-store";
import { DomainError } from "../src/lib/domain";
const id = "10000000-0000-4000-8000-000000000001", placement = "20000000-0000-4000-8000-000000000001", bytes = Buffer.from("verified-image");
const row = { storage_key: `variants/${id}/v1/display-${checksum(bytes)}.webp`, size_bytes: BigInt(bytes.length), mime_type: "image/webp", revision_id: "revision-1" };
function reader(responses: unknown[][]) { let n = 0; return { $queryRaw: async () => responses[Math.min(n++, responses.length - 1)] } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">; }
test("public image SQL requires current published permission, snapshot placement, ready sanitized derivative", () => {
  const q = publicImageQuery(id, placement, "DISPLAY");
  for (const pattern of [/r.id = c.published_revision_id/, /revision_kind = 'PUBLISHED'/, /effective_visibility = 'PUBLIC'/, /c.deleted_at IS NULL/, /m.deleted_at IS NULL/, /processing_status = 'READY'/, /metadata_sanitized = TRUE/, /is_active = TRUE/, /snapshot->'placements'/]) assert.match(q.text, pattern);
  assert.deepEqual(q.values, [placement, "DISPLAY", id]); assert.doesNotMatch(q.text, /original|content_drafts/);
});
test("authorized image returns bytes with no-store and no storage redirect", async () => {
  const store: ObjectStore = { get: async () => bytes, putImmutable: async () => {} };
  const response = await publicImage(id, placement, "DISPLAY", store, reader([[row], [row]]));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("location"), null); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(Buffer.from(await response.arrayBuffer()).toString(), bytes.toString());
});
test("private or stale publication denies before storage and is rechecked after slow object read", async () => {
  let reads = 0; const store: ObjectStore = { get: async () => { reads++; return bytes; }, putImmutable: async () => {} };
  await assert.rejects(publicImage(id, placement, "DISPLAY", store, reader([[]])), e => e instanceof DomainError && e.status === 404); assert.equal(reads, 0);
  for (const next of [[], [{ ...row, revision_id: "new-revision" }]]) await assert.rejects(publicImage(id, placement, "DISPLAY", store, reader([[row], next])), e => e instanceof DomainError && e.status === 404);
});
test("corrupted derived bytes never become a successful public image", async () => {
  const store: ObjectStore = { get: async () => Buffer.from("corrupted"), putImmutable: async () => {} };
  await assert.rejects(publicImage(id, placement, "DISPLAY", store, reader([[row]])), e => e instanceof DomainError && e.status === 503);
});
