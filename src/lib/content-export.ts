import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError, parseStoredPayload } from "./domain";
import { checksum, objectStore, type ObjectStore } from "./object-store";
import { imageLimits } from "./image-processing";
import { ZipArchive } from "./zip-archive";
export type ExportOptions = { includeMedia: boolean; maxBytes: number };
type Client = Pick<ReturnType<typeof db>, "$transaction">;
const json = (value: unknown) => Buffer.from(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n");
/** Builds one consistent content snapshot. It does not create a job or publish/download an archive. */
export async function buildContentArchive(adminId: string, options: ExportOptions, client: Client = db(), store?: ObjectStore) {
  const zip = new ZipArchive(options.maxBytes), files: { path: string; sizeBytes: number; sha256: string }[] = [];
  const add = (path: string, bytes: Buffer) => { zip.add(path, bytes); files.push({ path, sizeBytes: bytes.length, sha256: checksum(bytes) }); };
  const addJson = (path: string, value: unknown) => add(path, json(value));
  return client.$transaction(async guard => {
    await guard.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${"media:gc"}, 0))::text`;
    return client.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
    const [snapshot] = await tx.$queryRaw<{ capturedAt: Date }[]>`SELECT transaction_timestamp() AS "capturedAt"`;
    let contentAfter: string | undefined;
    do {
      const contents = await tx.content.findMany({ where: { ownerId: adminId, ...(contentAfter ? { id: { gt: contentAfter } } : {}) }, select: { id: true, type: true, module: true, publicationState: true, effectiveVisibility: true, stateVersion: true, publishedRevisionId: true, firstPublishedAt: true, lastPublishedAt: true, deletedAt: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: 20 });
      for (const content of contents) {
        const root = `contents/${content.id}`; addJson(`${root}/state.json`, content);
        const draft = await tx.contentDraft.findUnique({ where: { contentId: content.id }, select: { draftPayload: true, revisionNumber: true, basedOnRevisionId: true, lastSavedAt: true } });
        if (!draft) throw new DomainError(500, "INTERNAL_ERROR", "导出内容缺少草稿");
        addJson(`${root}/draft.json`, { ...draft, draftPayload: parseStoredPayload(draft.draftPayload) });
        let revisionAfter = 0;
        while (true) {
          const revisions = await tx.contentRevision.findMany({ where: { contentId: content.id, versionNumber: { gt: revisionAfter } }, select: { id: true, versionNumber: true, publishedEditionNumber: true, revisionKind: true, restoredFromRevisionId: true, snapshot: true, createdAt: true }, orderBy: { versionNumber: "asc" }, take: 20 });
          for (const revision of revisions) addJson(`${root}/revisions/${revision.versionNumber}.json`, { ...revision, snapshot: parseStoredPayload(revision.snapshot) });
          if (revisions.length < 20) break; revisionAfter = revisions.at(-1)!.versionNumber;
        }
        let routeAfter: string | undefined;
        while (true) {
          const routes = await tx.contentRoute.findMany({ where: { contentId: content.id, ...(routeAfter ? { path: { gt: routeAfter } } : {}) }, select: { path: true, routeKind: true }, orderBy: { path: "asc" }, take: 100 });
          if (routes.length) addJson(`${root}/routes-${files.length}.json`, routes);
          if (routes.length < 100) break; routeAfter = routes.at(-1)!.path;
        }
      }
      if (contents.length < 20) break; contentAfter = contents.at(-1)!.id;
    } while (true);
    for (const kind of ["categories", "tags"] as const) {
      let after: string | undefined;
      while (true) {
        const where = after ? { id: { gt: after } } : {};
        const rows = kind === "categories" ? await tx.category.findMany({ where, select: { id: true, module: true, parentId: true, name: true, slug: true, sortOrder: true, isSystem: true, deletedAt: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: 100 }) : await tx.tag.findMany({ where, select: { id: true, name: true, slug: true, deletedAt: true, createdAt: true, updatedAt: true }, orderBy: { id: "asc" }, take: 100 });
        if (rows.length) addJson(`taxonomy/${kind}-${files.length}.json`, rows);
        if (rows.length < 100) break; after = rows.at(-1)!.id;
      }
    }
    let mediaAfter: string | undefined;
    while (true) {
      const media = await tx.media.findMany({ where: { uploadedBy: adminId, ...(mediaAfter ? { id: { gt: mediaAfter } } : {}) }, select: { id: true, storageKey: true, originalFilename: true, mimeType: true, sizeBytes: true, checksumSha256: true, width: true, height: true, capturedAt: true, captureTimeTrusted: true, uploadedAt: true, processingStatus: true, deletedAt: true }, orderBy: { id: "asc" }, take: 20 });
      for (const { storageKey, ...item } of media) {
        const path = `media/${item.id}/original`, originalIncluded = options.includeMedia && !item.deletedAt;
        addJson(`media/${item.id}/metadata.json`, { ...item, originalIncluded, originalPath: originalIncluded ? path : null });
        if (originalIncluded) {
          if (item.sizeBytes < 1n || item.sizeBytes > BigInt(imageLimits.bytes) || item.sizeBytes > BigInt(zip.remainingBytes)) throw new DomainError(422, "INVALID_INPUT", "媒体超出导出处理限额");
          const bytes = await (store || objectStore()).get(storageKey, Number(item.sizeBytes));
          if (BigInt(bytes.length) !== item.sizeBytes || checksum(bytes) !== item.checksumSha256) throw new DomainError(503, "SERVICE_UNAVAILABLE", "导出原图校验失败");
          add(path, bytes);
        }
      }
      if (media.length < 20) break; mediaAfter = media.at(-1)!.id;
    }
    const manifest = { schemaVersion: 1, format: "personal-space-content-export", capturedAt: snapshot.capturedAt.toISOString(), includeMedia: options.includeMedia, files };
    zip.add("manifest.json", json(manifest));
    const bytes = zip.finish(); return { bytes, manifest, sha256: checksum(bytes) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 });
  }, { timeout: 130000 });
}
