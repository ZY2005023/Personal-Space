import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError } from "./domain";
import { checksum, objectStore, type ObjectStore } from "./object-store";
import { imageLimits } from "./image-processing";
type Variant = "THUMBNAIL" | "DISPLAY";
type ImageRow = { storage_key: string; size_bytes: bigint; mime_type: string; revision_id: string };
export function publicImageQuery(contentId: string, placementId: string, variant: Variant) {
  return Prisma.sql`SELECT v.storage_key, v.size_bytes, v.mime_type, r.id AS revision_id
    FROM contents c JOIN content_revisions r ON r.content_id = c.id AND r.id = c.published_revision_id AND r.revision_kind = 'PUBLISHED'
    JOIN revision_media p ON p.revision_id = r.id AND p.placement_id = ${placementId}::uuid
    JOIN media m ON m.id = p.media_id AND m.deleted_at IS NULL AND m.processing_status = 'READY'
    JOIN media_variants v ON v.media_id = m.id AND v.variant_type = ${variant} AND v.is_active = TRUE AND v.metadata_sanitized = TRUE
    WHERE c.id = ${contentId}::uuid AND c.publication_state = 'PUBLISHED' AND c.effective_visibility = 'PUBLIC' AND c.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.snapshot->'placements') entry WHERE entry->>'placementId' = p.placement_id::text AND entry->>'mediaId' = p.media_id::text)
    ORDER BY v.processing_version DESC LIMIT 2`;
}
function imageHeaders(mimeType: string, attachment?: string) {
  return { "Content-Type": mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...(attachment ? { "Content-Disposition": `attachment; filename="image"; filename*=UTF-8''${encodeURIComponent(attachment).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16))}` } : {}) };
}
async function derivedBytes(row: { storage_key: string; size_bytes: bigint; mime_type: string }, store: ObjectStore) {
  if (row.mime_type !== "image/webp" || row.size_bytes < 1n || row.size_bytes > BigInt(imageLimits.bytes)) throw new DomainError(503, "SERVICE_UNAVAILABLE", "派生图片记录无效");
  const bytes = await store.get(row.storage_key, Number(row.size_bytes));
  const digest = /-([a-f0-9]{64})\.webp$/.exec(row.storage_key)?.[1];
  if (BigInt(bytes.length) !== row.size_bytes || !digest || checksum(bytes) !== digest) throw new DomainError(503, "SERVICE_UNAVAILABLE", "派生图片校验失败");
  return bytes;
}
async function readImageRows(query: Prisma.Sql, reader?: Pick<Prisma.TransactionClient, "$queryRaw">) {
  if (reader) return reader.$queryRaw<ImageRow[]>(query);
  return db().$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`;
    return tx.$queryRaw<ImageRow[]>(query);
  }, { timeout: 5000 });
}
export async function publicImage(contentId: string, placementId: string, variant: Variant, store?: ObjectStore, reader?: Pick<Prisma.TransactionClient, "$queryRaw">) {
  const query = publicImageQuery(contentId, placementId, variant);
  const rows = await readImageRows(query, reader);
  if (rows.length !== 1) throw new DomainError(404, "NOT_FOUND", "图片不存在");
  const bytes = await derivedBytes(rows[0], store || objectStore());
  // Slow object reads must not return a stale permission decision or old publication.
  const latest = await readImageRows(query, reader);
  if (latest.length !== 1 || latest[0].revision_id !== rows[0].revision_id || latest[0].storage_key !== rows[0].storage_key) throw new DomainError(404, "NOT_FOUND", "图片不存在");
  return new Response(new Uint8Array(bytes), { headers: imageHeaders("image/webp") });
}
type AdminImageReader = Pick<ReturnType<typeof db>, "media" | "mediaVariant">;
export async function adminImage(adminId: string, mediaId: string, variant: Variant | "ORIGINAL", store?: ObjectStore, reader?: AdminImageReader) {
  mediaId = mediaId.toLowerCase();
  const client = reader || db();
  const ownedMedia = async () => {
    const media = await client.media.findFirst({ where: { id: mediaId, uploadedBy: adminId, deletedAt: null } });
    if (!media) throw new DomainError(404, "NOT_FOUND", "图片不存在");
    return media;
  };
  const media = await ownedMedia();
  if (variant === "ORIGINAL") {
    if (media.sizeBytes < 1n || media.sizeBytes > BigInt(imageLimits.bytes) || !media.storageKey.startsWith(`originals/${mediaId}/`)) throw new DomainError(503, "SERVICE_UNAVAILABLE", "原图记录无效");
    const bytes = await (store || objectStore()).get(media.storageKey, Number(media.sizeBytes));
    if (BigInt(bytes.length) !== media.sizeBytes || checksum(bytes) !== media.checksumSha256) throw new DomainError(503, "SERVICE_UNAVAILABLE", "原图校验失败");
    const latest = await ownedMedia();
    if (latest.storageKey !== media.storageKey || latest.sizeBytes !== media.sizeBytes || latest.checksumSha256 !== media.checksumSha256) throw new DomainError(404, "NOT_FOUND", "图片已变更，请重新加载");
    return new Response(new Uint8Array(bytes), { headers: imageHeaders("application/octet-stream", media.originalFilename) });
  }
  if (media.processingStatus !== "READY") throw new DomainError(404, "NOT_FOUND", "图片尚不可用");
  const activeVariants = () => client.mediaVariant.findMany({ where: { mediaId, variantType: variant, isActive: true, metadataSanitized: true }, take: 2 });
  const rows = await activeVariants();
  if (rows.length !== 1) throw new DomainError(404, "NOT_FOUND", "图片尚不可用");
  const selected = rows[0];
  if (!selected.storageKey.startsWith(`variants/${mediaId}/`)) throw new DomainError(503, "SERVICE_UNAVAILABLE", "派生图片记录无效");
  const bytes = await derivedBytes({ storage_key: selected.storageKey, size_bytes: selected.sizeBytes, mime_type: selected.mimeType }, store || objectStore());
  const latest = await ownedMedia();
  if (latest.processingStatus !== "READY") throw new DomainError(404, "NOT_FOUND", "图片尚不可用");
  const current = await activeVariants();
  if (current.length !== 1 || current[0].id !== selected.id || current[0].storageKey !== selected.storageKey || current[0].processingVersion !== selected.processingVersion || current[0].sizeBytes !== selected.sizeBytes || current[0].mimeType !== selected.mimeType) throw new DomainError(404, "NOT_FOUND", "图片已变更，请重新加载");
  return new Response(new Uint8Array(bytes), { headers: imageHeaders("image/webp") });
}
