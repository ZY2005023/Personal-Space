import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError } from "./domain";
import { objectStore, type RemovableObjectStore } from "./object-store";
import { lockRows } from "./reference-store";
import { log } from "./logger";
const Payload = z.strictObject({ mediaId: z.uuid(), sourceEventId: z.uuid() });
type Client = Pick<ReturnType<typeof db>, "$transaction">;
export function claimGcSql(token: string) { return Prisma.sql`WITH candidate AS (SELECT id FROM operation_jobs WHERE job_type = 'MEDIA_GC' AND ((status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())) OR (status = 'RUNNING' AND lease_until <= clock_timestamp())) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE operation_jobs j SET status = 'RUNNING', attempts = attempts + 1, lease_token = ${token}::uuid, lease_until = clock_timestamp() + interval '5 minutes', started_at = COALESCE(started_at, clock_timestamp()), updated_at = clock_timestamp() FROM candidate WHERE j.id = candidate.id RETURNING j.id`; }
export async function runMediaGc(graceMs: number, store: RemovableObjectStore = objectStore(), client: Client = db()) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 1) throw new DomainError(503, "SERVICE_UNAVAILABLE", "请明确配置媒体清理宽限期");
  const job = await client.$transaction(async tx => { const rows = await tx.$queryRaw<{ id: string }[]>(claimGcSql(randomUUID())); return rows.length ? tx.operationJob.findUniqueOrThrow({ where: { id: rows[0].id } }) : null; });
  if (!job) return false;
  const fence = async (tx: Prisma.TransactionClient) => (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM operation_jobs WHERE id = ${job.id}::uuid AND status = 'RUNNING' AND lease_token = ${job.leaseToken}::uuid AND lease_until > clock_timestamp() FOR UPDATE`).length === 1;
  try {
    const payload = Payload.safeParse(job.payload); if (!payload.success || job.attempts > 3) throw new DomainError(422, "INVALID_INPUT", "清理任务无效");
    await client.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media:gc"}, 0))::text`;
      await lockRows(tx, "media", [payload.data.mediaId]); if (!await fence(tx)) return;
      const media = await tx.media.findUnique({ where: { id: payload.data.mediaId } });
      if (!media) { await tx.operationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", result: { mediaId: payload.data.mediaId, removedCount: 0 }, completedAt: new Date(), leaseToken: null, leaseUntil: null } }); return; }
      if (!media.deletedAt) throw new DomainError(409, "RESOURCE_REFERENCED", "媒体尚未删除，不能清理");
      const due = new Date(media.deletedAt.getTime() + graceMs);
      if (due > new Date()) { await tx.operationJob.update({ where: { id: job.id }, data: { status: "PENDING", attempts: job.attempts - 1, nextAttemptAt: due, leaseToken: null, leaseUntil: null } }); return; }
      const counts = await Promise.all([tx.draftMedia.count({ where: { mediaId: media.id } }), tx.revisionMedia.count({ where: { mediaId: media.id } }), tx.contentMedia.count({ where: { mediaId: media.id } })]);
      if (counts.some(n => n > 0)) throw new DomainError(409, "RESOURCE_REFERENCED", "媒体仍有引用，不能清理");
      const keys = new Set<string>([media.storageKey]); let after: string | undefined;
      while (true) { const variants = await tx.mediaVariant.findMany({ where: { mediaId: media.id, ...(after ? { id: { gt: after } } : {}) }, select: { id: true, storageKey: true }, orderBy: { id: "asc" }, take: 100 }); for (const variant of variants) keys.add(variant.storageKey); if (variants.length < 100) break; after = variants.at(-1)!.id; }
      if ([...keys].some(key => !key.startsWith(`originals/${media.id}/`) && !key.startsWith(`variants/${media.id}/`))) throw new DomainError(422, "INVALID_INPUT", "媒体存储标识不匹配");
      for (const key of keys) await store.delete(key);
      if (!await fence(tx)) return;
      await tx.auditLog.create({ data: { actorId: media.uploadedBy, action: "MEDIA_PURGED", targetType: "MEDIA", targetId: media.id, metadata: { jobId: job.id, removedCount: keys.size } } });
      await tx.operationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", result: { mediaId: media.id, removedCount: keys.size }, errorCode: null, completedAt: new Date(), nextAttemptAt: null, leaseToken: null, leaseUntil: null } });
    }, { timeout: 240000 });
  } catch (error) {
    log("warn", "media.gc.blocked", { jobId: job.id, attempts: job.attempts, code: error instanceof DomainError ? error.code : "STORAGE_UNAVAILABLE" });
    await client.$transaction(async tx => { if (!await fence(tx)) return; const failed = error instanceof DomainError && error.status < 500 || job.attempts >= 3; await tx.operationJob.update({ where: { id: job.id }, data: { status: failed ? "FAILED" : "PENDING", errorCode: "MEDIA_GC_BLOCKED", completedAt: failed ? new Date() : null, nextAttemptAt: failed ? null : new Date(Date.now() + job.attempts * 30000), leaseToken: null, leaseUntil: null } }); });
  }
  return true;
}
