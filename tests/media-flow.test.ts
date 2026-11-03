import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Prisma, type Media, type OperationJob, type IdempotencyRecord } from "../src/generated/prisma/client";
import { uploadMedia, deleteMedia } from "../src/lib/media-store";
import { claimJobSql, runMediaJob } from "../src/lib/media-worker";
import type { ObjectStore } from "../src/lib/object-store";
import { DomainError } from "../src/lib/domain";
const adminId = "10000000-0000-4000-8000-000000000001";
function fixture() {
  const state = { media: null as Media | null, job: null as OperationJob | null, record: null as IdempotencyRecord | null, audits: [] as string[], variants: [] as unknown[], references: 0, loseLease: false, failStorage: false, corrupt: false, writes: 0 };
  const objects = new Map<string, Buffer>();
  const store: ObjectStore = {
    get: async key => { if (state.failStorage) throw new Error("Storage unavailable"); const value = objects.get(key); if (!value) throw new Error("Missing original"); return state.corrupt ? Buffer.from("corrupt") : Buffer.from(value); },
    putImmutable: async (key, bytes) => { state.writes++; if (state.failStorage) throw new Error("Storage unavailable"); const old = objects.get(key); if (old && !old.equals(bytes)) throw new Error("Immutable collision"); objects.set(key, Buffer.from(bytes)); },
  };
  const copy = <T,>(value: T): T => structuredClone(value);
  const tx = {
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(query) ? query.join("") : (query as Prisma.Sql).text;
      if (text.includes("WITH candidate")) { if (!state.job || state.job.status !== "PENDING") return []; state.job.status = "RUNNING"; state.job.attempts++; state.job.leaseToken = (query as Prisma.Sql).values[0] as string; return [{ id: state.job.id }]; }
      if (text.includes("lease_until >")) return !state.loseLease && state.job?.status === "RUNNING" && state.job.leaseToken === values[1] ? [{ id: state.job.id }] : [];
      return [];
    },
    media: {
      create: async ({ data }: { data: Partial<Media> }) => { state.media = { capturedAt: null, captureTimeTrusted: false, uploadedAt: new Date(), createdAt: new Date(), deletedAt: null, ...data, sizeBytes: BigInt(data.sizeBytes!) } as Media; return copy(state.media); },
      findUniqueOrThrow: async () => { if (!state.media) throw new Error("Missing media"); return copy(state.media); },
      findFirst: async () => state.media?.deletedAt ? null : copy(state.media),
      update: async ({ data }: { data: Partial<Media> }) => { Object.assign(state.media!, data); return copy(state.media!); },
      updateMany: async ({ data }: { data: Partial<Media> }) => { if (!state.media?.deletedAt) Object.assign(state.media!, data); return { count: 1 }; },
    },
    operationJob: {
      create: async ({ data }: { data: Partial<OperationJob> }) => { state.job = { id: randomUUID(), status: "PENDING", attempts: 0, leaseUntil: null, leaseToken: null, result: null, errorCode: null, createdAt: new Date(), updatedAt: new Date(), startedAt: null, completedAt: null, ...data } as OperationJob; return copy(state.job); },
      findUniqueOrThrow: async () => copy(state.job!),
      update: async ({ data }: { data: Partial<OperationJob> }) => { Object.assign(state.job!, data); return copy(state.job!); },
    },
    idempotencyRecord: {
      findUnique: async ({ where }: { where: { adminId_operationScope_idempotencyKey: { operationScope: string } } }) => state.record?.operationScope === where.adminId_operationScope_idempotencyKey.operationScope ? copy(state.record) : null,
      findUniqueOrThrow: async () => copy(state.record!),
      delete: async () => { state.record = null; },
      create: async ({ data }: { data: Partial<IdempotencyRecord> }) => { state.record = { id: randomUUID(), createdAt: new Date(), ...data } as IdempotencyRecord; return copy(state.record); },
      update: async ({ data }: { data: Partial<IdempotencyRecord> }) => { Object.assign(state.record!, data); return copy(state.record!); },
    },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { state.audits.push(data.action); } },
    mediaVariant: { updateMany: async () => {}, upsert: async ({ create }: { create: unknown }) => { state.variants.push(create); } },
    draftMedia: { count: async () => state.references }, revisionMedia: { count: async () => 0 }, contentMedia: { count: async () => 0 },
    outboxEvent: { create: async () => {} },
  };
  const client = { ...tx, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as NonNullable<Parameters<typeof runMediaJob>[1]>;
  return { state, objects, store, client };
}
async function file() { return { bytes: await sharp({ create: { width: 8, height: 4, channels: 3, background: "red" } }).png().toBuffer(), filename: "photo.png", mimeType: "image/png" }; }
test("upload creates one durable reservation, replays accepted response and rejects different same-key input", async () => {
  const f = fixture(), input = await file();
  const first = await uploadMedia(adminId, "upload-key-000001", input, f.store, f.client);
  assert.equal(f.state.media?.processingStatus, "PROCESSING"); assert.equal(f.state.job?.status, "PENDING"); assert.equal(f.state.record?.status, "COMPLETED");
  assert.deepEqual(await uploadMedia(adminId, "upload-key-000001", input, f.store, f.client), first); assert.equal(f.state.writes, 1); assert.equal(f.state.audits.length, 1);
  await assert.rejects(uploadMedia(adminId, "upload-key-000001", { ...input, filename: "different.png" }, f.store, f.client), e => e instanceof DomainError && e.code === "IDEMPOTENCY_MISMATCH");
});
test("interrupted original upload retains its reservation and same-key retry resumes the same media", async () => {
  const f = fixture(), input = await file(); f.state.failStorage = true;
  await assert.rejects(uploadMedia(adminId, "upload-key-000001", input, f.store, f.client));
  const id = f.state.media?.id; assert.equal(f.state.media?.processingStatus, "UPLOADING"); assert.equal(f.state.record?.status, "PROCESSING");
  f.state.failStorage = false; await uploadMedia(adminId, "upload-key-000001", input, f.store, f.client); assert.equal(f.state.media?.id, id); assert.equal(f.state.media?.processingStatus, "PROCESSING");
});
test("worker verifies original and both stored derivatives before atomically marking ready/succeeded", async () => {
  const f = fixture(); await uploadMedia(adminId, "upload-key-000001", await file(), f.store, f.client);
  assert.equal(await runMediaJob(f.store, f.client), true); assert.equal(f.state.media?.processingStatus, "READY"); assert.equal(f.state.job?.status, "SUCCEEDED"); assert.equal(f.state.variants.length, 2); assert.equal(f.objects.size, 3);
  assert.equal(await runMediaJob(f.store, f.client), false);
});
test("worker with a lost lease cannot activate derivatives or mark media ready", async () => {
  const f = fixture(); await uploadMedia(adminId, "upload-key-000001", await file(), f.store, f.client); f.state.loseLease = true;
  await runMediaJob(f.store, f.client); assert.equal(f.state.media?.processingStatus, "PROCESSING"); assert.equal(f.state.job?.status, "RUNNING"); assert.equal(f.state.variants.length, 0);
});
test("transient storage errors retry at most three times; corrupted originals fail without activation", async () => {
  const f = fixture(); await uploadMedia(adminId, "upload-key-000001", await file(), f.store, f.client); f.state.failStorage = true;
  for (let n = 1; n <= 3; n++) { await runMediaJob(f.store, f.client); assert.equal(f.state.job?.attempts, n); assert.equal(f.state.job?.status, n === 3 ? "FAILED" : "PENDING"); }
  assert.equal(f.state.media?.processingStatus, "FAILED"); assert.equal(f.state.variants.length, 0);
  const g = fixture(); await uploadMedia(adminId, "upload-key-000001", await file(), g.store, g.client); g.state.corrupt = true; await runMediaJob(g.store, g.client); assert.equal(g.state.job?.status, "FAILED"); assert.equal(g.state.variants.length, 0);
});
test("media deletion refuses any historical reference and only soft-deletes unreferenced rows", async () => {
  const f = fixture(); await uploadMedia(adminId, "upload-key-000001", await file(), f.store, f.client); const id = f.state.media!.id; f.state.references = 1;
  await assert.rejects(deleteMedia(adminId, id, "delete-key-000001", f.client), e => e instanceof DomainError && e.code === "RESOURCE_REFERENCED"); assert.equal(f.state.media?.deletedAt, null);
  f.state.references = 0; await deleteMedia(adminId, id, "delete-key-000001", f.client); assert.ok(f.state.media?.deletedAt); assert.equal(f.objects.size, 1);
  await deleteMedia(adminId, id, "delete-key-000001", f.client); assert.equal(f.state.audits.length, 2);
});
test("queue claim is bounded, uses SKIP LOCKED, database time, and parameterized lease token", () => {
  const token = randomUUID(), query = claimJobSql(token); assert.match(query.text, /FOR UPDATE SKIP LOCKED LIMIT 1/); assert.match(query.text, /lease_until <= clock_timestamp/); assert.match(query.text, /interval '5 minutes'/); assert.deepEqual(query.values, [token]);
});
test("uploaded original survives a crash before acceptance and worker recovers the reservation", async () => {
  const f = fixture(), input = await file(); await uploadMedia(adminId, "upload-key-000001", input, f.store, f.client);
  const id = f.state.media!.id, jobId = f.state.job!.id;
  f.state.media!.processingStatus = "UPLOADING"; f.state.record!.status = "PROCESSING"; f.state.record!.responseReference = { mediaId: id, jobId };
  await runMediaJob(f.store, f.client); assert.equal(f.state.media?.processingStatus, "READY");
  const accepted = await uploadMedia(adminId, "upload-key-000001", input, f.store, f.client) as { media: { id: string; processingStatus: string } };
  assert.equal(accepted.media.id, id); assert.equal(accepted.media.processingStatus, "READY"); assert.equal(f.state.job?.id, jobId);
});
test("a corrupted stored derivative is retried without activating it", async () => {
  const f = fixture(); await uploadMedia(adminId, "upload-key-000001", await file(), f.store, f.client);
  const store = { ...f.store, get: async (key: string, max: number) => key.startsWith("variants/") ? Buffer.from("broken") : f.store.get(key, max) };
  await runMediaJob(store, f.client); assert.equal(f.state.job?.status, "PENDING"); assert.equal(f.state.media?.processingStatus, "PROCESSING"); assert.equal(f.state.variants.length, 0);
  await runMediaJob(f.store, f.client); assert.equal(f.state.media?.processingStatus, "READY");
});
test("deleting a media while its job runs cannot resurrect it", async () => {
  const f = fixture(); await uploadMedia(adminId, "upload-key-000001", await file(), f.store, f.client);
  const store = { ...f.store, putImmutable: async (key: string, bytes: Buffer, mime: string) => { await f.store.putImmutable(key, bytes, mime); if (key.startsWith("variants/")) f.state.media!.deletedAt = new Date(); } };
  await runMediaJob(store, f.client); assert.ok(f.state.media?.deletedAt); assert.equal(f.state.job?.status, "FAILED"); assert.equal(f.state.variants.length, 0); assert.notEqual(f.state.media?.processingStatus, "READY");
});
