import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError, requestHash } from "./domain";
import { inspectImage } from "./image-processing";
import { mediaSelect, mediaView, jobView, MediaJobPayload } from "./media";
import { objectStore, type ObjectStore } from "./object-store";
import { lockRows, assertMediaCanDelete } from "./reference-store";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Client = Pick<ReturnType<typeof db>, "$transaction">;
export async function uploadMedia(adminId: string, key: string, file: { bytes: Buffer; filename: string; mimeType: string }, store: ObjectStore = objectStore(), client: Client = db()) {
  const image = await inspectImage(file.bytes, file.mimeType), scope = "media:upload";
  const hash = requestHash({ checksum: image.checksumSha256, filename: file.filename, mimeType: image.mimeType });
  const reservation = await client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${adminId + ":" + scope + ":" + key}, 0))::text`;
    const old = await tx.idempotencyRecord.findUnique({ where: { adminId_operationScope_idempotencyKey: { adminId, operationScope: scope, idempotencyKey: key } } });
    if (old && old.expiresAt > new Date()) {
      if (old.requestHash !== hash) throw new DomainError(409, "IDEMPOTENCY_MISMATCH", "请求标识已用于其他文件或参数");
      return { recordId: old.id, completed: old.status === "COMPLETED", response: old.responseReference };
    }
    if (old) await tx.idempotencyRecord.delete({ where: { id: old.id } });
    const mediaId = randomUUID();
    await tx.media.create({ data: { id: mediaId, storageProvider: "S3", storageKey: `originals/${mediaId}/original`, originalFilename: file.filename, mimeType: image.mimeType, sizeBytes: image.sizeBytes, checksumSha256: image.checksumSha256, width: image.width, height: image.height, processingStatus: "UPLOADING", uploadedBy: adminId } });
    const job = await tx.operationJob.create({ data: { jobType: "MEDIA_PROCESS", payload: { mediaId, adminId, processingVersion: 1 }, nextAttemptAt: new Date(Date.now() + 60_000) } });
    const record = await tx.idempotencyRecord.create({ data: { adminId, operationScope: scope, idempotencyKey: key, requestHash: hash, status: "PROCESSING", responseReference: { mediaId, jobId: job.id }, expiresAt: new Date(Date.now() + 86400000) } });
    return { recordId: record.id, completed: false, response: { mediaId, jobId: job.id } };
  });
  if (reservation.completed) return reservation.response;
  const { mediaId, jobId } = reservation.response as { mediaId: string; jobId: string };
  // External I/O must not keep a database transaction or row lock open.
  await store.putImmutable(`originals/${mediaId}/original`, file.bytes, image.mimeType);
  return client.$transaction(async tx => {
    await lockRows(tx, "media", [mediaId]);
    await tx.$queryRaw`SELECT id FROM operation_jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
    const record = await tx.idempotencyRecord.findUniqueOrThrow({ where: { id: reservation.recordId } });
    if (record.status === "COMPLETED") return record.responseReference;
    const media = await tx.media.findUniqueOrThrow({ where: { id: mediaId } });
    const job = await tx.operationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (media.deletedAt || media.processingStatus === "FAILED" || job.status === "FAILED") throw new DomainError(409, "MEDIA_NOT_READY", "该次上传已失效，请使用新请求重新上传");
    const next = media.processingStatus === "UPLOADING" ? await tx.media.update({ where: { id: mediaId }, data: { processingStatus: "PROCESSING" } }) : media;
    if (job.status === "PENDING") await tx.operationJob.update({ where: { id: jobId }, data: { nextAttemptAt: new Date() } });
    const response = { media: mediaView(next), job: jobView(job) };
    await tx.idempotencyRecord.update({ where: { id: record.id }, data: { status: "COMPLETED", responseStatus: 202, responseReference: json(response) } });
    await tx.auditLog.create({ data: { actorId: adminId, action: "media:upload", targetType: "MEDIA", targetId: mediaId, metadata: { jobId } } });
    return json(response);
  });
}
export async function listMedia(adminId: string, status: string | undefined, limit: number, after: { id: string; publishedAt: string } | null) {
  return db().media.findMany({ where: { uploadedBy: adminId, deletedAt: null, ...(status ? { processingStatus: status } : {}), ...(after ? { OR: [{ uploadedAt: { lt: new Date(after.publishedAt) } }, { uploadedAt: new Date(after.publishedAt), id: { lt: after.id } }] } : {}) }, select: mediaSelect, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], take: limit + 1 });
}
export async function getMedia(adminId: string, id: string) {
  const media = await db().media.findFirst({ where: { id, uploadedBy: adminId, deletedAt: null } });
  if (!media) throw new DomainError(404, "NOT_FOUND", "图片不存在");
  return media;
}
export async function getMediaJob(adminId: string, id: string) {
  const job = await db().operationJob.findUnique({ where: { id } });
  const payload = MediaJobPayload.safeParse(job?.payload);
  if (!job || job.jobType !== "MEDIA_PROCESS" || !payload.success || payload.data.adminId !== adminId) throw new DomainError(404, "NOT_FOUND", "任务不存在");
  await getMedia(adminId, payload.data.mediaId);
  return jobView(job);
}
export async function deleteMedia(adminId: string, id: string, key: string, client: Client = db()) {
  await client.$transaction(async tx => {
    const scope = `media:${id}:delete`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${adminId + ":" + scope + ":" + key}, 0))::text`;
    const previous = await tx.idempotencyRecord.findUnique({ where: { adminId_operationScope_idempotencyKey: { adminId, operationScope: scope, idempotencyKey: key } } });
    if (previous && previous.expiresAt > new Date()) return;
    if (previous) await tx.idempotencyRecord.delete({ where: { id: previous.id } });
    await assertMediaCanDelete(tx, id);
    const media = await tx.media.findUniqueOrThrow({ where: { id } });
    if (media.uploadedBy !== adminId) throw new DomainError(404, "NOT_FOUND", "图片不存在");
    await tx.media.update({ where: { id }, data: { deletedAt: new Date() } });
    // Retain private objects until a separately implemented retention/GC consumer verifies deletion.
    await tx.outboxEvent.create({ data: { eventType: "MEDIA_DELETED", aggregateId: id, payload: { mediaId: id } } });
    await tx.auditLog.create({ data: { actorId: adminId, action: scope, targetType: "MEDIA", targetId: id, metadata: {} } });
    await tx.idempotencyRecord.create({ data: { adminId, operationScope: scope, idempotencyKey: key, requestHash: requestHash({ id }), status: "COMPLETED", responseStatus: 204, responseReference: {}, expiresAt: new Date(Date.now() + 86400000) } });
  });
}
