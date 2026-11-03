import { z } from "zod";
import { DomainError } from "./domain";
import { imageLimits } from "./image-processing";
export const Variant = z.enum(["THUMBNAIL", "DISPLAY"]);
export const MediaStatus = z.enum(["UPLOADING", "PROCESSING", "READY", "FAILED"]);
export const MediaJobPayload = z.strictObject({ mediaId: z.uuid(), adminId: z.uuid(), processingVersion: z.literal(1) });
export function safeFilename(name: string) { return Array.from(name.normalize("NFKC").replace(/[\\/\p{Cc}\p{Cf}]/gu, "_").trim()).slice(0, 200).join("") || "image"; }
export const mediaSelect = { id: true, originalFilename: true, mimeType: true, sizeBytes: true, width: true, height: true, capturedAt: true, captureTimeTrusted: true, uploadedAt: true, processingStatus: true } as const;
type MediaRow = { id: string; originalFilename: string; mimeType: string; sizeBytes: bigint; width: number | null; height: number | null; capturedAt: Date | null; captureTimeTrusted: boolean; uploadedAt: Date; processingStatus: string };
export function mediaView(row: MediaRow) {
  if (row.sizeBytes < 1 || row.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError(500, "INTERNAL_ERROR", "图片大小记录无效");
  return { id: row.id, originalFilename: row.originalFilename, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes), width: row.width, height: row.height, capturedAt: row.capturedAt?.toISOString() || null, captureTimeTrusted: row.captureTimeTrusted, uploadedAt: row.uploadedAt.toISOString(), processingStatus: MediaStatus.parse(row.processingStatus) };
}
export function jobView(row: { id: string; jobType: string; status: string; attempts: number; errorCode: string | null; createdAt: Date; completedAt: Date | null; result: unknown }) {
  const property = row.jobType === "EXPORT" ? "exportId" : row.jobType === "BACKUP" ? "backupId" : "mediaId";
  const result = z.object({ [property]: z.uuid() }).safeParse(row.result);
  return { id: row.id, jobType: row.jobType, status: row.status, attempts: row.attempts, errorCode: row.errorCode, resultResourceId: result.success ? result.data[property] : null, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() || null };
}
/** Bound the request body before the multipart parser allocates file buffers. */
export async function readImageUpload(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用文件上传表单");
  const limit = imageLimits.bytes + 64 * 1024, declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "上传内容超过限额");
  const reader = request.body?.getReader(); if (!reader) throw new DomainError(400, "INVALID_INPUT", "缺少上传文件");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) { await reader.cancel(); throw new DomainError(413, "PAYLOAD_TOO_LARGE", "上传内容超过限额"); } chunks.push(next.value); } }
  finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new DomainError(400, "INVALID_INPUT", "文件上传格式错误"); }
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) throw new DomainError(422, "INVALID_INPUT", "每次只接收一个 file 文件");
  const file = entries[0][1];
  if (!file.size || file.size > imageLimits.bytes) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "单张图片须在 10 MiB 以内");
  return { bytes: Buffer.from(await file.arrayBuffer()), filename: safeFilename(file.name), mimeType: file.type };
}
