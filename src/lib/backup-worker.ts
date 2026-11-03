import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError } from "./domain";
import { buildBackupBundle, verifyBackupBundle, type BackupTools, type BackupBundleConfig } from "./backup-pipeline";
import type { ObjectStore } from "./object-store";
const Payload = z.strictObject({ adminId: z.uuid(), backupId: z.uuid(), backupType: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "MANUAL"]) });
type Client = Pick<ReturnType<typeof db>, "$transaction">;
export function claimBackupSql(token: string) { return Prisma.sql`WITH candidate AS (
  SELECT id FROM operation_jobs WHERE job_type = 'BACKUP' AND ((status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())) OR (status = 'RUNNING' AND lease_until <= clock_timestamp())) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
) UPDATE operation_jobs j SET status = 'RUNNING', attempts = attempts + 1, lease_token = ${token}::uuid, lease_until = clock_timestamp() + interval '5 minutes', started_at = COALESCE(started_at, clock_timestamp()), updated_at = clock_timestamp() FROM candidate WHERE j.id = candidate.id RETURNING j.id`; }
export async function runBackupJob(config: BackupBundleConfig, tools: BackupTools, client: Client = db(), store?: ObjectStore, build = buildBackupBundle, verify = verifyBackupBundle) {
  const job = await client.$transaction(async tx => { const rows = await tx.$queryRaw<{ id: string }[]>(claimBackupSql(randomUUID())); return rows.length ? tx.operationJob.findUniqueOrThrow({ where: { id: rows[0].id } }) : null; });
  if (!job) return false;
  const fence = async (tx: Prisma.TransactionClient) => (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM operation_jobs WHERE id = ${job.id}::uuid AND status = 'RUNNING' AND lease_token = ${job.leaseToken}::uuid AND lease_until > clock_timestamp() FOR UPDATE`).length === 1;
  const payload = Payload.safeParse(job.payload); let localReady = false, backupId: string | undefined, renewal: Promise<unknown> | undefined;
  const heartbeat = setInterval(() => { if (renewal) return; renewal = client.$transaction(tx => tx.$executeRaw`UPDATE operation_jobs SET lease_until = clock_timestamp() + interval '5 minutes', updated_at = clock_timestamp() WHERE id = ${job.id}::uuid AND status = 'RUNNING' AND lease_token = ${job.leaseToken}::uuid AND lease_until > clock_timestamp()`).catch(() => {}).finally(() => { renewal = undefined; }); }, 30000); heartbeat.unref();
  try {
    if (!payload.success || job.attempts > 3) throw new DomainError(422, "INVALID_INPUT", "备份任务无效或重试耗尽"); backupId = payload.data.backupId;
    const record = await client.$transaction(async tx => { if (!await fence(tx)) return null; const row = await tx.backupRun.findFirst({ where: { id: backupId, jobId: job.id } }); if (!row) throw new DomainError(422, "INVALID_INPUT", "备份任务与记录不匹配"); await tx.backupRun.update({ where: { id: row.id }, data: { status: "RUNNING", startedAt: row.startedAt || new Date(), completedAt: null, localStatus: row.localStatus === "SUCCEEDED" ? "SUCCEEDED" : "RUNNING", offsiteStatus: "PENDING", errorSummary: null } }); return row; });
    if (!record) return true;
    let bundle;
    if (record.localStatus === "SUCCEEDED" && record.integrityStatus === "SUCCEEDED" && record.manifestPath) { bundle = await verify(path.dirname(record.manifestPath), config.maxBytes); if (bundle.checksum !== record.checksum) throw new Error("Stored manifest changed"); }
    else bundle = await build(backupId, job.leaseToken!, config, tools, client, store);
    localReady = true;
    const active = await client.$transaction(async tx => { if (!await fence(tx)) return false; await tx.backupRun.update({ where: { id: backupId }, data: { status: "VERIFYING", localStatus: "SUCCEEDED", integrityStatus: "SUCCEEDED", offsiteStatus: "RUNNING", manifestPath: bundle.manifestPath, checksum: bundle.checksum, sizeBytes: bundle.sizeBytes, verifiedAt: new Date() } }); await tx.backupCopy.upsert({ where: { backupRunId_copyType_locationKey: { backupRunId: backupId!, copyType: "LOCAL", locationKey: bundle.directory } }, create: { backupRunId: backupId!, copyType: "LOCAL", locationKey: bundle.directory, status: "SUCCEEDED", checksum: bundle.checksum, verifiedAt: new Date() }, update: { status: "SUCCEEDED", checksum: bundle.checksum, verifiedAt: new Date() } }); return true; });
    if (!active) return true;
    const snapshotId = await tools.offsite(bundle.directory, backupId);
    await client.$transaction(async tx => { if (!await fence(tx)) return; await tx.backupCopy.upsert({ where: { backupRunId_copyType_locationKey: { backupRunId: backupId!, copyType: "OFFSITE", locationKey: `restic:${snapshotId}` } }, create: { backupRunId: backupId!, copyType: "OFFSITE", locationKey: `restic:${snapshotId}`, status: "SUCCEEDED", checksum: bundle.checksum, verifiedAt: new Date() }, update: { status: "SUCCEEDED", verifiedAt: new Date() } }); await tx.backupRun.update({ where: { id: backupId }, data: { status: "SUCCEEDED", offsiteStatus: "SUCCEEDED", completedAt: new Date(), errorSummary: null } }); await tx.operationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", result: { backupId }, errorCode: null, completedAt: new Date(), leaseToken: null, leaseUntil: null, nextAttemptAt: null } }); });
  } catch (error) {
    await client.$transaction(async tx => { if (!await fence(tx)) return; const failed = error instanceof DomainError && error.status < 500 || job.attempts >= 3; if (backupId) await tx.backupRun.updateMany({ where: { id: backupId, jobId: job.id }, data: { status: "FAILED", ...(localReady ? { offsiteStatus: "FAILED" } : { localStatus: "FAILED", integrityStatus: "FAILED" }), errorSummary: localReady ? "OFFSITE_UNAVAILABLE" : "LOCAL_BACKUP_UNAVAILABLE", completedAt: new Date() } }); await tx.operationJob.update({ where: { id: job.id }, data: { status: failed ? "FAILED" : "PENDING", errorCode: localReady ? "OFFSITE_UNAVAILABLE" : "LOCAL_BACKUP_UNAVAILABLE", completedAt: failed ? new Date() : null, nextAttemptAt: failed ? null : new Date(Date.now() + job.attempts * 30000), leaseToken: null, leaseUntil: null } }); });
  } finally { clearInterval(heartbeat); await renewal; }
  return true;
}
