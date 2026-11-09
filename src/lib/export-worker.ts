import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError } from "./domain";
import { buildContentArchive, type ExportOptions } from "./content-export";
import { checksum, type ObjectStore } from "./object-store";
import { log } from "./logger";
export interface ExportArchiveStore {
  /** Keys must be private and immutable, unique to this attempt. */
  put(exportId: string, attemptToken: string, bytes: Buffer): Promise<string>;
  get(key: string, maxBytes: number): Promise<Buffer>;
}
export const ExportJobPayload = z.strictObject({ adminId: z.uuid(), includeMedia: z.boolean() });
type Client = Pick<ReturnType<typeof db>, "$transaction">;
type Builder = typeof buildContentArchive;
export function claimExportSql(token: string) {
  return Prisma.sql`WITH candidate AS (
    SELECT id FROM operation_jobs WHERE job_type = 'EXPORT' AND (
      (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())) OR
      (status = 'RUNNING' AND lease_until <= clock_timestamp())
    ) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE operation_jobs j SET status = 'RUNNING', attempts = attempts + 1,
    lease_token = ${token}::uuid, lease_until = clock_timestamp() + interval '5 minutes',
    started_at = COALESCE(started_at, clock_timestamp()), updated_at = clock_timestamp()
    FROM candidate WHERE j.id = candidate.id RETURNING j.id`;
}
/** Archive backend, maximum bytes and download lifetime must be supplied by the runtime. */
export async function runExportJob(archives: ExportArchiveStore, config: { maxBytes: number; ttlMs: number }, client: Client = db(), sourceStore?: ObjectStore, build: Builder = buildContentArchive) {
  if (!Number.isSafeInteger(config.ttlMs) || config.ttlMs <= 0 || !Number.isFinite(new Date(Date.now() + config.ttlMs).getTime()) || !Number.isSafeInteger(config.maxBytes) || config.maxBytes < 22 || config.maxBytes > 0xffffffff) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出运行配置不正确");
  const job = await client.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>(claimExportSql(randomUUID()));
    return rows.length ? tx.operationJob.findUniqueOrThrow({ where: { id: rows[0].id } }) : null;
  });
  if (!job) return false;
  const fence = async (tx: Prisma.TransactionClient) => (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM operation_jobs WHERE id = ${job.id}::uuid AND status = 'RUNNING' AND lease_token = ${job.leaseToken}::uuid AND lease_until > clock_timestamp() FOR UPDATE`).length === 1;
  try {
    const payload = ExportJobPayload.safeParse(job.payload);
    if (!payload.success || job.attempts > 3) throw new DomainError(422, "INVALID_INPUT", "导出任务无效或重试耗尽");
    const options: ExportOptions = { includeMedia: payload.data.includeMedia, maxBytes: config.maxBytes };
    const archive = await build(payload.data.adminId, options, client, sourceStore);
    const stillOwned = await client.$transaction(tx => fence(tx)); if (!stillOwned) return true;
    const storageKey = await archives.put(job.id, job.leaseToken!, archive.bytes);
    const verified = await archives.get(storageKey, archive.bytes.length);
    if (verified.length !== archive.bytes.length || checksum(verified) !== archive.sha256) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出文件回读校验失败");
    await client.$transaction(async tx => {
      if (!await fence(tx)) return;
      await tx.operationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", result: { exportId: job.id, adminId: payload.data.adminId, storageKey, sizeBytes: verified.length, sha256: archive.sha256, expiresAt: new Date(Date.now() + config.ttlMs).toISOString() }, errorCode: null, completedAt: new Date(), nextAttemptAt: null, leaseToken: null, leaseUntil: null } });
    });
  } catch (error) {
    const permanent = error instanceof DomainError && error.status < 500;
    log(permanent ? "warn" : "error", "export.job.failed", { jobId: job.id, attempts: job.attempts, permanent });
    await client.$transaction(async tx => {
      if (!await fence(tx)) return;
      const failed = permanent || job.attempts >= 3;
      await tx.operationJob.update({ where: { id: job.id }, data: { status: failed ? "FAILED" : "PENDING", errorCode: permanent ? "EXPORT_REJECTED" : "EXPORT_UNAVAILABLE", completedAt: failed ? new Date() : null, nextAttemptAt: failed ? null : new Date(Date.now() + job.attempts * 30000), leaseToken: null, leaseUntil: null } });
    });
  }
  return true;
}
