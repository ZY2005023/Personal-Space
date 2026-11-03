import { z } from "zod";
import { db } from "./db";
import { DomainError, requestHash } from "./domain";
import { lockAdmin, consumeProof } from "./security-store";
import type { SecurityContext } from "./auth-policy";
import { ExportJobPayload, type ExportArchiveStore } from "./export-worker";
import { checksum } from "./object-store";
import { jobView } from "./media";
import { getMediaJob } from "./media-store";
export const ExportInput = z.strictObject({ includeMedia: z.boolean() });
const resultSchema = z.object({ exportId: z.uuid(), adminId: z.uuid(), storageKey: z.string(), sizeBytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.iso.datetime() });
type Client = Pick<ReturnType<typeof db>, "$transaction" | "operationJob">;
export async function createExport(context: SecurityContext, input: unknown, key: string, proof: string, client: Pick<Client, "$transaction"> = db()) {
  const body = ExportInput.parse(input), hash = requestHash(body), scope = "exports:create";
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.adminId + ":" + scope + ":" + key}, 0))::text`;
    const previous = await tx.idempotencyRecord.findUnique({ where: { adminId_operationScope_idempotencyKey: { adminId: context.adminId, operationScope: scope, idempotencyKey: key } } });
    if (previous && previous.expiresAt > new Date()) { if (previous.requestHash !== hash) throw new DomainError(409, "IDEMPOTENCY_MISMATCH", "请求标识已用于其他导出参数"); return previous.responseReference; }
    if (previous) await tx.idempotencyRecord.delete({ where: { id: previous.id } });
    await lockAdmin(tx, context); await consumeProof(tx, context, proof, "REAUTH", "EXPORT_CREATE");
    const job = await tx.operationJob.create({ data: { jobType: "EXPORT", payload: { adminId: context.adminId, includeMedia: body.includeMedia } } });
    const response = jobView(job);
    await tx.auditLog.create({ data: { actorId: context.adminId, action: "EXPORT_CREATED", targetType: "JOB", targetId: job.id, metadata: { includeMedia: body.includeMedia } } });
    await tx.idempotencyRecord.create({ data: { adminId: context.adminId, operationScope: scope, idempotencyKey: key, requestHash: hash, status: "COMPLETED", responseStatus: 202, responseReference: response, expiresAt: new Date(Date.now() + 86400000) } });
    return response;
  });
}
export async function getOperationJob(adminId: string, id: string, client: Pick<Client, "operationJob"> = db()) {
  const job = await client.operationJob.findUnique({ where: { id } });
  if (job?.jobType === "MEDIA_PROCESS") return getMediaJob(adminId, id);
  const payload = z.object({ adminId: z.uuid() }).safeParse(job?.payload);
  if (!job || !["EXPORT", "BACKUP"].includes(job.jobType) || !payload.success || payload.data.adminId !== adminId) throw new DomainError(404, "NOT_FOUND", "任务不存在");
  return jobView(job);
}
export async function downloadExport(adminId: string, id: string, store: ExportArchiveStore, maxBytes: number, client: Pick<Client, "operationJob"> = db()) {
  const read = async () => {
    const job = await client.operationJob.findUnique({ where: { id } }), payload = ExportJobPayload.safeParse(job?.payload);
    if (!job || job.jobType !== "EXPORT" || !payload.success || payload.data.adminId !== adminId) throw new DomainError(404, "NOT_FOUND", "导出不存在");
    if (job.status !== "SUCCEEDED") throw new DomainError(409, "STATE_CONFLICT", "导出尚未生成成功");
    const result = resultSchema.safeParse(job.result);
    if (!result.success || result.data.exportId !== id || result.data.adminId !== adminId || Date.parse(result.data.expiresAt) <= Date.now()) throw new DomainError(404, "NOT_FOUND", "导出已过期或不存在"); return result.data;
  };
  const result = await read(); if (result.sizeBytes > maxBytes) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出超过当前读取限额");
  const bytes = await store.get(result.storageKey, result.sizeBytes);
  if (bytes.length !== result.sizeBytes || checksum(bytes) !== result.sha256) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出文件校验失败");
  const latest = await read(); if (latest.storageKey !== result.storageKey || latest.sha256 !== result.sha256) throw new DomainError(404, "NOT_FOUND", "导出已变更");
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="personal-space-${id}.zip"`, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
