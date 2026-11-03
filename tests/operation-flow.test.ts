import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createExport, downloadExport, getOperationJob } from "../src/lib/export-store";
import { createBackup } from "../src/lib/backup-store";
import { LocalExportArchiveStore } from "../src/lib/export-artifacts";
import { reauthenticate } from "../src/lib/security-store";
import { totp } from "../src/lib/crypto";
import { authFixture, context, password, secret } from "./helpers/auth-fixture";
import { checksum } from "../src/lib/object-store";
import { DomainError } from "../src/lib/domain";
async function fixture() {
  const f = await authFixture(), data = { jobs: [] as Record<string, any>[], records: [] as Record<string, any>[], backups: [] as Record<string, any>[] };
  Object.assign(f.tx, {
    operationJob: { create: async ({ data: input }: { data: Record<string,unknown> }) => { const row = { id: randomUUID(), status: "PENDING", attempts: 0, errorCode: null, result: null, createdAt: new Date(), completedAt: null, ...input }; data.jobs.push(row); return structuredClone(row); }, findUnique: async ({ where }: { where: { id: string } }) => structuredClone(data.jobs.find(row => row.id === where.id) || null) },
    backupRun: { create: async ({ data: input }: { data: Record<string, unknown> }) => { data.backups.push(input); return input; } },
    idempotencyRecord: { findUnique: async ({ where }: { where: Record<string, any> }) => { const key = where.adminId_operationScope_idempotencyKey; return structuredClone(data.records.find(row => row.adminId === key.adminId && row.operationScope === key.operationScope && row.idempotencyKey === key.idempotencyKey) || null); }, create: async ({ data: input }: { data: Record<string,unknown> }) => { data.records.push({ id: randomUUID(), ...input }); }, delete: async ({ where }: { where: { id: string } }) => { data.records = data.records.filter(row => row.id !== where.id); } },
  });
  const transaction = f.client.$transaction.bind(f.client);
  (f.client as any).$transaction = async (fn: (tx: unknown) => unknown) => { const prior = structuredClone(data); try { return await (transaction as any)(fn); } catch (e) { Object.assign(data, prior); throw e; } };
  (f.client as any).operationJob = (f.tx as any).operationJob;
  return { ...f, data };
}
async function grant(f: Awaited<ReturnType<typeof fixture>>, operation: "EXPORT_CREATE" | "BACKUP_CREATE") { return reauthenticate(context, { password, code: totp(secret, Math.floor(Date.now() / 30000)), recovery: false }, operation, f.client); }
test("export create consumes its operation proof once and exact retry replays one task", async () => {
  const f = await fixture(), proof = await grant(f, "EXPORT_CREATE"), first = await createExport(context, { includeMedia: true }, "test-export-key-0001", proof.token, f.client);
  const second = await createExport(context, { includeMedia: true }, "test-export-key-0001", "", f.client);
  assert.deepEqual(first, second); assert.equal(f.data.jobs.length, 1); assert.ok(f.state.challenges[0].usedAt);
  await assert.rejects(createExport(context, { includeMedia: false }, "test-export-key-0001", proof.token, f.client), e => e instanceof DomainError && e.status === 409);
});
test("backup creation is purpose-bound and creates the backup row in the same transaction", async () => {
  const f = await fixture(), proof = await grant(f, "BACKUP_CREATE");
  await assert.rejects(createExport(context, { includeMedia: true }, "wrong-purpose-key", proof.token, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  const job = await createBackup(context, "test-backup-key-0001", proof.token, f.client) as { id: string };
  assert.equal(f.data.backups[0].jobId, job.id); assert.equal(f.data.jobs[0].payload.backupId, f.data.backups[0].id);
  await createBackup(context, "test-backup-key-0001", "", f.client); assert.equal(f.data.jobs.length, 1);
});
test("failed audit rolls task, backup and proof consumption back together", async () => {
  const f = await fixture(), proof = await grant(f, "BACKUP_CREATE"); f.state.failAudit = true;
  await assert.rejects(createBackup(context, "test-backup-key-0001", proof.token, f.client));
  assert.equal(f.data.jobs.length, 0); assert.equal(f.data.backups.length, 0); assert.equal(f.state.challenges[0].usedAt, null);
});
test("owned job summaries do not expose archive keys or another administrator's task", async () => {
  const f = await fixture(), job = { id: randomUUID(), jobType: "EXPORT", payload: { adminId: context.adminId, includeMedia: false }, status: "SUCCEEDED", attempts: 1, errorCode: null, result: { exportId: randomUUID(), storageKey: "secret-key" }, createdAt: new Date(), completedAt: new Date() }; f.data.jobs.push(job);
  const summary = await getOperationJob(context.adminId, job.id, f.client); assert.equal(summary.resultResourceId, job.result.exportId); assert.doesNotMatch(JSON.stringify(summary), /secret-key/);
  await assert.rejects(getOperationJob(randomUUID(), job.id, f.client), e => e instanceof DomainError && e.status === 404);
});
test("download verifies ownership, readiness, expiration and actual archive checksum", async () => {
  const f = await fixture(), bytes = Buffer.from("zip"), id = randomUUID(), result = { exportId: id, adminId: context.adminId, storageKey: `${id}/${randomUUID()}.zip`, sizeBytes: bytes.length, sha256: checksum(bytes), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const job = { id, jobType: "EXPORT", payload: { adminId: context.adminId, includeMedia: false }, status: "PENDING", result }; f.data.jobs.push(job);
  let reads = 0; const store = { put: async () => "", get: async () => { reads++; return bytes; } };
  await assert.rejects(downloadExport(context.adminId, id, store, 100, f.client), e => e instanceof DomainError && e.status === 409); assert.equal(reads, 0);
  job.status = "SUCCEEDED"; const response = await downloadExport(context.adminId, id, store, 100, f.client); assert.equal(response.headers.get("content-type"), "application/zip"); assert.equal(response.headers.get("cache-control"), "private, no-store");
  result.expiresAt = new Date(0).toISOString(); await assert.rejects(downloadExport(context.adminId, id, store, 100, f.client), e => e instanceof DomainError && e.status === 404);
});
test("private local export files are immutable and bounded without touching source images", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "personal-space-test-export-"));
  try { const store = new LocalExportArchiveStore(root), id = randomUUID(), token = randomUUID(), bytes = Buffer.from("zip"); const key = await store.put(id, token, bytes); await store.put(id, token, bytes); assert.deepEqual(await store.get(key, 3), bytes); await assert.rejects(store.put(id, token, Buffer.from("bad"))); await assert.rejects(store.get(key, 2)); await assert.rejects(store.get("../secret", 100)); }
  finally { assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)); assert.ok(path.basename(root).startsWith("personal-space-test-")); await rm(root, { recursive: true, force: true }); }
});
