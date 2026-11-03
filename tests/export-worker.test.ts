import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma, type OperationJob } from "../src/generated/prisma/client";
import { runExportJob, claimExportSql, type ExportArchiveStore } from "../src/lib/export-worker";
import { checksum } from "../src/lib/object-store";
import { DomainError } from "../src/lib/domain";
const id = "10000000-0000-4000-8000-000000000001", adminId = "20000000-0000-4000-8000-000000000001";
function fixture() {
  const state = { job: { id, jobType: "EXPORT", payload: { adminId, includeMedia: true }, status: "PENDING", attempts: 0, leaseToken: null, leaseUntil: null } as unknown as OperationJob, loseLease: false, loseAfterWrite: false, corrupt: false, failStore: false, permanent: false, writes: 0, builds: 0 };
  const tx = {
    $queryRaw: async (q: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(q) ? q.join("") : (q as Prisma.Sql).text;
      if (text.includes("WITH candidate")) { if (state.job.status !== "PENDING") return []; state.job.status = "RUNNING"; state.job.attempts++; state.job.leaseToken = (q as Prisma.Sql).values[0] as string; return [{ id }]; }
      return !state.loseLease && state.job.status === "RUNNING" && state.job.leaseToken === values[1] ? [{ id }] : [];
    },
    operationJob: { findUniqueOrThrow: async () => structuredClone(state.job), update: async ({ data }: { data: Partial<OperationJob> }) => { Object.assign(state.job, data); } },
  };
  const client = { $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as NonNullable<Parameters<typeof runExportJob>[2]>;
  const bytes = Buffer.from("zip bytes"), archive = { bytes, sha256: checksum(bytes), manifest: { schemaVersion: 1, format: "personal-space-content-export", capturedAt: new Date().toISOString(), includeMedia: true, files: [] } };
  const build = (async (actor: string, options: { includeMedia: boolean; maxBytes: number }) => { state.builds++; assert.equal(actor, adminId); assert.equal(options.includeMedia, true); if (state.permanent) throw new DomainError(422, "INVALID_INPUT", "limit"); return archive; }) as NonNullable<Parameters<typeof runExportJob>[4]>;
  const store: ExportArchiveStore = { put: async (exportId, token) => { assert.equal(exportId, id); assert.ok(token); state.writes++; if (state.failStore) throw new Error("storage"); if (state.loseAfterWrite) state.loseLease = true; return `exports/${id}/${token}.zip`; }, get: async (_, max) => { assert.equal(max, bytes.length); return state.corrupt ? Buffer.from("corrupt") : bytes; } };
  return { state, client, build, store };
}
const config = { maxBytes: 100000, ttlMs: 60000 };
test("export claims only due or expired export jobs with skip-locked leases", () => {
  const query = claimExportSql(id); assert.match(query.text, /job_type = 'EXPORT'/); assert.match(query.text, /FOR UPDATE SKIP LOCKED LIMIT 1/); assert.match(query.text, /lease_until <= clock_timestamp/); assert.deepEqual(query.values, [id]);
});
test("export succeeds only after artifact write/read validation and records owned expiring result", async () => {
  const f = fixture(); assert.equal(await runExportJob(f.store, config, f.client, undefined, f.build), true);
  assert.equal(f.state.job.status, "SUCCEEDED"); assert.equal(f.state.writes, 1); assert.equal(f.state.job.leaseToken, null);
  const result = f.state.job.result as Record<string, string>; assert.equal(result.exportId, id); assert.equal(result.adminId, adminId); assert.ok(Date.parse(result.expiresAt) > Date.now());
  assert.equal(await runExportJob(f.store, config, f.client, undefined, f.build), false); assert.equal(f.state.builds, 1);
});
test("malformed or rejected tasks fail without writing an artifact", async () => {
  for (const invalid of [true, false]) {
    const f = fixture(); if (invalid) f.state.job.payload = { adminId: "bad", includeMedia: true }; else f.state.permanent = true;
    await runExportJob(f.store, config, f.client, undefined, f.build); assert.equal(f.state.job.status, "FAILED"); assert.equal(f.state.writes, 0); assert.equal(f.state.job.errorCode, "EXPORT_REJECTED");
  }
});
test("unavailable or corrupt artifact storage retries at most three attempts", async () => {
  for (const corrupt of [true, false]) {
    const f = fixture(); f.state.corrupt = corrupt; f.state.failStore = !corrupt;
    for (let attempt = 1; attempt <= 3; attempt++) { await runExportJob(f.store, config, f.client, undefined, f.build); assert.equal(f.state.job.attempts, attempt); assert.equal(f.state.job.status, attempt === 3 ? "FAILED" : "PENDING"); }
    assert.equal(f.state.job.errorCode, "EXPORT_UNAVAILABLE");
  }
});
test("lost execution lease prevents writes or completion by an obsolete worker", async () => {
  const early = fixture(); early.state.loseLease = true; await runExportJob(early.store, config, early.client, undefined, early.build); assert.equal(early.state.writes, 0); assert.equal(early.state.job.status, "RUNNING");
  const late = fixture(); late.state.loseAfterWrite = true; await runExportJob(late.store, config, late.client, undefined, late.build); assert.equal(late.state.writes, 1); assert.equal(late.state.job.status, "RUNNING");
});
test("runtime archive size and expiry are explicit configuration, validated before claims", async () => {
  const f = fixture(); await assert.rejects(runExportJob(f.store, { ...config, ttlMs: 0 }, f.client, undefined, f.build), DomainError); assert.equal(f.state.job.attempts, 0);
});
