import { test } from "node:test";
import assert from "node:assert/strict";
import { adminImage } from "../src/lib/media-response";
import { checksum, type ObjectStore } from "../src/lib/object-store";
import { DomainError } from "../src/lib/domain";
const mediaId = "10000000-0000-4000-8000-000000000001", adminId = "20000000-0000-4000-8000-000000000001";
const bytes = Buffer.from("verified image");
function fixture() {
  const media = { storageKey: `originals/${mediaId}/original`, sizeBytes: BigInt(bytes.length), checksumSha256: checksum(bytes), originalFilename: "照片\r\n.txt", processingStatus: "READY" };
  const variant = { id: "variant-1", storageKey: `variants/${mediaId}/v1/display-${checksum(bytes)}.webp`, sizeBytes: BigInt(bytes.length), mimeType: "image/webp", processingVersion: 1 };
  const state = { media: [media, { ...media }] as (typeof media | null)[], variants: [[variant], [{ ...variant }]], reads: 0, maxBytes: 0, content: bytes };
  let mediaReads = 0, variantReads = 0;
  const reader = {
    media: { findFirst: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { id: mediaId, uploadedBy: adminId, deletedAt: null }); return state.media[Math.min(mediaReads++, state.media.length - 1)]; } },
    mediaVariant: { findMany: async (args: unknown) => { assert.deepEqual(args, { where: { mediaId, variantType: "DISPLAY", isActive: true, metadataSanitized: true }, take: 2 }); return state.variants[Math.min(variantReads++, state.variants.length - 1)]; } },
  } as unknown as NonNullable<Parameters<typeof adminImage>[4]>;
  const store: ObjectStore = { get: async (_, max) => { state.reads++; state.maxBytes = max; return state.content; }, putImmutable: async () => { throw new Error("Read must not write"); } };
  return { state, reader, store };
}
const denied = (e: unknown) => e instanceof DomainError && e.status === 404;
test("owned original is bounded, checksum verified and served only as a private attachment", async () => {
  const f = fixture(); const response = await adminImage(adminId, mediaId, "ORIGINAL", f.store, f.reader);
  assert.equal(f.state.maxBytes, bytes.length); assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition")!, /%0D%0A/); assert.doesNotMatch(response.headers.get("content-disposition")!, /[\r\n]/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
test("missing ownership rejects before storage and deletion during storage rejects before response", async () => {
  const f = fixture(); f.state.media = [null]; await assert.rejects(adminImage(adminId, mediaId, "ORIGINAL", f.store, f.reader), denied); assert.equal(f.state.reads, 0);
  for (const kind of ["ORIGINAL", "DISPLAY"] as const) {
    const g = fixture(); g.state.media[1] = null; await assert.rejects(adminImage(adminId, mediaId, kind, g.store, g.reader), denied); assert.equal(g.state.reads, 1);
  }
});
test("original key, size or checksum changes during reading cannot serve stale bytes", async () => {
  for (const change of [{ storageKey: `originals/${mediaId}/different` }, { sizeBytes: 1n }, { checksumSha256: "different" }]) {
    const f = fixture(); Object.assign(f.state.media[1]!, change); await assert.rejects(adminImage(adminId, mediaId, "ORIGINAL", f.store, f.reader), denied);
  }
});
test("invalid original size or media namespace rejects without object reads", async () => {
  for (const change of [{ sizeBytes: 0n }, { sizeBytes: 999999999n }, { storageKey: `originals/${adminId}/original` }]) {
    const f = fixture(); Object.assign(f.state.media[0]!, change); await assert.rejects(adminImage(adminId, mediaId, "ORIGINAL", f.store, f.reader), e => e instanceof DomainError && e.status === 503); assert.equal(f.state.reads, 0);
  }
});
test("admin derivative serves only one sanitized active variant with private no-store headers", async () => {
  const f = fixture(); const response = await adminImage(adminId, mediaId, "DISPLAY", f.store, f.reader);
  assert.equal(response.headers.get("content-type"), "image/webp"); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("location"), null); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
test("variant replacement, deactivation, ambiguity or media reprocessing during reading rejects", async () => {
  for (const change of [{ id: "variant-2" }, { storageKey: "different" }, { processingVersion: 2 }, { sizeBytes: 1n }, { mimeType: "image/png" }, null, "duplicate", "processing"] as const) {
    const f = fixture();
    if (change === null) f.state.variants[1] = [];
    else if (change === "duplicate") f.state.variants[1].push({ ...f.state.variants[1][0] });
    else if (change === "processing") f.state.media[1]!.processingStatus = "PROCESSING";
    else Object.assign(f.state.variants[1][0], change);
    await assert.rejects(adminImage(adminId, mediaId, "DISPLAY", f.store, f.reader), denied);
  }
});
test("bad original or derivative bytes and wrong variant namespace are never successful responses", async () => {
  for (const kind of ["ORIGINAL", "DISPLAY"] as const) {
    const f = fixture(); f.state.content = Buffer.from("corrupt"); await assert.rejects(adminImage(adminId, mediaId, kind, f.store, f.reader), e => e instanceof DomainError && e.status === 503);
  }
  const g = fixture(); g.state.variants[0][0].storageKey = `variants/${adminId}/v1/display-${checksum(bytes)}.webp`;
  await assert.rejects(adminImage(adminId, mediaId, "DISPLAY", g.store, g.reader), DomainError); assert.equal(g.state.reads, 0);
});
