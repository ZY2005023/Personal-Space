import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { buildBackupBundle, verifyBackupBundle, type BackupTools } from "../src/lib/backup-pipeline";
import { checksum, type ObjectStore } from "../src/lib/object-store";
import { postgresToolEnv } from "../src/lib/backup-runtime";
import { backupPlans, scheduleBackups } from "../src/lib/backup-scheduler";
import { databaseIdentity } from "../src/lib/restore-drill";
import { runCommand } from "../src/lib/process-runner";
async function temp(fn: (root: string) => Promise<void>) { const root = await mkdtemp(path.join(tmpdir(), "personal-space-test-backup-")); try { await fn(root); } finally { assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)); assert.ok(path.basename(root).startsWith("personal-space-test-")); await rm(root, { recursive: true, force: true }); } }
function fixture() {
  const mediaId = randomUUID(), original = Buffer.from("original"), variant = Buffer.from("derived"), locks: string[] = [];
  const objects = new Map([[`originals/${mediaId}/original`, original], [`variants/${mediaId}/v1/display-${checksum(variant)}.webp`, variant]]);
  const tx = { $executeRaw: async () => 0, $queryRaw: async (q: TemplateStringsArray) => { const sql = q.join(""); locks.push(sql); if (sql.includes("pg_export_snapshot")) return [{ snapshotId: "00000001-00000001-1", capturedAt: new Date("2026-11-03T05:00:00Z") }]; if (sql.includes("count(*)")) return [{ contents: 1n, content_revisions: 2n, media: 1n, categories: 1n, tags: 1n, admin_users: 1n }]; return []; }, media: { findMany: async () => [{ id: mediaId, storageKey: `originals/${mediaId}/original`, sizeBytes: BigInt(original.length), checksumSha256: checksum(original) }] }, mediaVariant: { findMany: async () => [{ id: randomUUID(), storageKey: [...objects.keys()][1], sizeBytes: BigInt(variant.length) }] } };
  const client = { $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as NonNullable<Parameters<typeof buildBackupBundle>[4]>;
  const tools: BackupTools = { dump: async (snapshot, file) => { assert.equal(snapshot, "00000001-00000001-1"); await writeFile(file, "custom dump fixture"); }, checkDump: async file => { assert.equal((await readFile(file)).toString(), "custom dump fixture"); }, offsite: async () => "snapshot-id" };
  const store: ObjectStore = { get: async (key, max) => { const bytes = objects.get(key)!; assert.equal(max, bytes.length); return bytes; }, putImmutable: async () => { throw new Error("Must not modify source"); } };
  return { client, tools, store, locks, objects };
}
test("backup bundle captures snapshot and counts, copies originals/variants and verifies every file", async () => { await temp(async root => { const f = fixture(), bundle = await buildBackupBundle(randomUUID(), randomUUID(), { root, maxBytes: 100000, timeoutMs: 10000 }, f.tools, f.client, f.store), verified = await verifyBackupBundle(bundle.directory, 100000); assert.equal(verified.checksum, bundle.checksum); assert.equal(verified.manifest.files.length, 3); assert.equal(verified.manifest.rowCounts.contents, 1); assert.match(f.locks[0], /pg_advisory_xact_lock_shared/); assert.match(f.locks[1], /pg_export_snapshot/); }); });
test("backup verifier refuses corrupted stored bytes", async () => { await temp(async root => { const f = fixture(), bundle = await buildBackupBundle(randomUUID(), randomUUID(), { root, maxBytes: 100000, timeoutMs: 10000 }, f.tools, f.client, f.store); await writeFile(path.join(bundle.directory, "database.dump"), "corrupt"); await assert.rejects(verifyBackupBundle(bundle.directory, 100000)); }); });
test("backup build fails on a missing object or configured size exhaustion", async () => { await temp(async root => { const f = fixture(); await assert.rejects(buildBackupBundle(randomUUID(), randomUUID(), { root, maxBytes: 100000, timeoutMs: 10000 }, f.tools, f.client, { ...f.store, get: async () => { throw new Error("missing"); } })); await assert.rejects(buildBackupBundle(randomUUID(), randomUUID(), { root, maxBytes: 3, timeoutMs: 10000 }, f.tools, f.client, f.store)); }); });
test("PostgreSQL tools receive decoded credentials through environment rather than arguments", () => { const env = postgresToolEnv("postgresql://owner:p%40ss@localhost:5432/example?sslmode=require"); assert.equal(env.PGPASSWORD, "p@ss"); assert.equal(env.PGDATABASE, "example"); assert.equal(env.PGSSLMODE, "require"); assert.equal(databaseIdentity("postgresql://a:secret@LOCALHOST/example"), databaseIdentity("postgresql://b:other@localhost:5432/example")); });
test("backup plans use Hong Kong time and catch the latest due daily and tier periods", () => { const before = backupPlans(new Date("2026-11-02T18:00:00Z"), "03:00"); assert.equal(before[0].period, "2026-11-02"); const after = backupPlans(new Date("2026-11-02T20:00:00Z"), "03:00"); assert.equal(after[0].period, "2026-11-03"); assert.equal(after[1].period, "2026-11-02"); assert.equal(after[2].period, "2026-11"); assert.equal(after[3].period, "2026"); assert.throws(() => backupPlans(new Date(), "bad")); });
test("scheduled tier creation is opt-in and deduplicated per period", async () => {
  const prior = process.env.BACKUP_AUTOMATIC, records = new Set<string>(); let jobs = 0;
  const tx = { $queryRaw: async () => [], idempotencyRecord: { findUnique: async ({ where }: any) => records.has(where.adminId_operationScope_idempotencyKey.idempotencyKey) ? {} : null, create: async ({ data }: any) => { records.add(data.idempotencyKey); } }, operationJob: { create: async () => ({ id: String(++jobs) }) }, backupRun: { create: async () => {} }, auditLog: { create: async () => {} } };
  const client = { adminUser: { findFirst: async () => ({ id: randomUUID() }) }, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as unknown as NonNullable<Parameters<typeof scheduleBackups>[1]>;
  try { process.env.BACKUP_AUTOMATIC = "false"; assert.equal(await scheduleBackups(new Date("2026-11-03T05:00:00Z"), client), 0); process.env.BACKUP_AUTOMATIC = "true"; assert.equal(await scheduleBackups(new Date("2026-11-03T05:00:00Z"), client), 4); assert.equal(await scheduleBackups(new Date("2026-11-03T05:00:00Z"), client), 0); assert.equal(jobs, 4); }
  finally { if (prior === undefined) delete process.env.BACKUP_AUTOMATIC; else process.env.BACKUP_AUTOMATIC = prior; }
});
test("command runner returns output and reports failures/timeouts without echoing arguments", async () => { assert.equal((await runCommand(process.execPath, ["-e", "console.log('ok')"], { timeoutMs: 1000 })).trim(), "ok"); await assert.rejects(runCommand(process.execPath, ["-e", "process.exit(3)"])); await assert.rejects(runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 10 })); });
