import { randomUUID } from "node:crypto";
import { Prisma, type OperationJob } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError } from "./domain";
import { processImage, imageLimits } from "./image-processing";
import { MediaJobPayload } from "./media";
import { checksum, objectStore, type ObjectStore } from "./object-store";
import { lockRows, type Tx } from "./reference-store";
type Client = Pick<ReturnType<typeof db>, "$transaction" | "operationJob" | "media">;
export function claimJobSql(token: string) {
  return Prisma.sql`WITH candidate AS (
    SELECT id FROM operation_jobs WHERE job_type = 'MEDIA_PROCESS' AND (
      (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())) OR
      (status = 'RUNNING' AND lease_until <= clock_timestamp())
    ) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE operation_jobs j SET status = 'RUNNING', attempts = attempts + 1,
    lease_token = ${token}::uuid, lease_until = clock_timestamp() + interval '5 minutes',
    started_at = COALESCE(started_at, clock_timestamp()), updated_at = clock_timestamp()
    FROM candidate WHERE j.id = candidate.id RETURNING j.id`;
}
async function fence(tx: Tx, job: OperationJob) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM operation_jobs WHERE id = ${job.id}::uuid AND status = 'RUNNING' AND lease_token = ${job.leaseToken}::uuid AND lease_until > clock_timestamp() FOR UPDATE`;
  return rows.length === 1;
}
export async function runMediaJob(store: ObjectStore = objectStore(), client: Client = db()): Promise<boolean> {
  const job = await client.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>(claimJobSql(randomUUID()));
    return rows.length ? tx.operationJob.findUniqueOrThrow({ where: { id: rows[0].id } }) : null;
  });
  if (!job) return false;
  const payload = MediaJobPayload.safeParse(job.payload);
  if (!payload.success) {
    await client.$transaction(async tx => { if (await fence(tx, job)) await tx.operationJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode: "INVALID_JOB", completedAt: new Date(), leaseToken: null, leaseUntil: null } }); });
    return true;
  }
  const { mediaId } = payload.data;
  let renewal: Promise<unknown> | undefined;
  const heartbeat = setInterval(() => {
    if (renewal) return;
    renewal = client.$transaction(tx => tx.$executeRaw`UPDATE operation_jobs SET lease_until = clock_timestamp() + interval '5 minutes', updated_at = clock_timestamp() WHERE id = ${job.id}::uuid AND status = 'RUNNING' AND lease_token = ${job.leaseToken}::uuid AND lease_until > clock_timestamp()`)
      .catch(() => { /* Completion always checks the actual database lease; never revive an expired lease. */ })
      .finally(() => { renewal = undefined; });
  }, 30_000);
  heartbeat.unref();
  try {
    if (job.attempts > 3) throw new DomainError(422, "INVALID_INPUT", "处理重试已耗尽");
    const media = await client.media.findUniqueOrThrow({ where: { id: mediaId } });
    if (media.deletedAt) throw new DomainError(422, "NOT_FOUND", "图片已删除");
    if (media.uploadedBy !== payload.data.adminId || media.storageProvider !== "S3") throw new DomainError(422, "INVALID_INPUT", "媒体任务归属无效");
    const original = await store.get(media.storageKey, imageLimits.bytes);
    if (checksum(original) !== media.checksumSha256 || BigInt(original.length) !== media.sizeBytes) throw new DomainError(422, "INVALID_INPUT", "原图校验失败");
    const active = await client.$transaction(async tx => {
      await lockRows(tx, "media", [mediaId]);
      if (!await fence(tx, job)) return false;
      const latest = await tx.media.findUniqueOrThrow({ where: { id: mediaId } });
      if (latest.deletedAt) throw new DomainError(422, "NOT_FOUND", "图片已删除");
      if (latest.processingStatus === "UPLOADING") await tx.media.update({ where: { id: mediaId }, data: { processingStatus: "PROCESSING" } });
      return true;
    });
    if (!active) return true;
    const processed = await processImage(original, media.mimeType);
    const variants: Prisma.MediaVariantCreateManyInput[] = [];
    for (const variant of processed.variants) {
      const storageKey = `variants/${mediaId}/v1/${variant.variantType.toLowerCase()}-${variant.checksumSha256}.webp`;
      await store.putImmutable(storageKey, variant.bytes, variant.mimeType);
      const verified = await store.get(storageKey, variant.bytes.length);
      if (verified.length !== variant.bytes.length || checksum(verified) !== variant.checksumSha256) throw new DomainError(503, "SERVICE_UNAVAILABLE", "派生图片存储校验失败");
      variants.push({ mediaId, storageKey, variantType: variant.variantType, processingVersion: 1, mimeType: variant.mimeType, width: variant.width, height: variant.height, sizeBytes: variant.sizeBytes, metadataSanitized: true, isActive: true });
    }
    await client.$transaction(async tx => {
      await lockRows(tx, "media", [mediaId]);
      if (!await fence(tx, job)) return;
      const latest = await tx.media.findUniqueOrThrow({ where: { id: mediaId } });
      if (latest.deletedAt) throw new DomainError(422, "NOT_FOUND", "图片已删除");
      await tx.mediaVariant.updateMany({ where: { mediaId }, data: { isActive: false } });
      for (const variant of variants) await tx.mediaVariant.upsert({ where: { mediaId_variantType_processingVersion: { mediaId, variantType: variant.variantType, processingVersion: 1 } }, create: variant, update: variant });
      await tx.media.update({ where: { id: mediaId }, data: { processingStatus: "READY", width: processed.variants[1].width, height: processed.variants[1].height } });
      await tx.operationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", result: { mediaId }, errorCode: null, completedAt: new Date(), leaseUntil: null, leaseToken: null } });
    });
  } catch (e) {
    const permanent = e instanceof DomainError && e.status < 500;
    await client.$transaction(async tx => {
      await lockRows(tx, "media", [mediaId]);
      if (!await fence(tx, job)) return;
      const failed = permanent || job.attempts >= 3;
      await tx.operationJob.update({ where: { id: job.id }, data: { status: failed ? "FAILED" : "PENDING", errorCode: permanent ? "IMAGE_REJECTED" : "STORAGE_UNAVAILABLE", completedAt: failed ? new Date() : null, nextAttemptAt: new Date(Date.now() + job.attempts * 30_000), leaseUntil: null, leaseToken: null } });
      if (failed) await tx.media.updateMany({ where: { id: mediaId, deletedAt: null }, data: { processingStatus: "FAILED" } });
    });
  } finally { clearInterval(heartbeat); await renewal; }
  return true;
}
