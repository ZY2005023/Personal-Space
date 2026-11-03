import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError } from "./domain";
import { checksum, objectStore, type ObjectStore } from "./object-store";
import { imageLimits } from "./image-processing";
export interface BackupTools { dump(snapshotId: string, file: string): Promise<void>; checkDump(file: string): Promise<void>; offsite(directory: string, backupId: string): Promise<string>; }
export type BackupBundleConfig = { root: string; maxBytes: number; timeoutMs: number };
export async function hashFile(file: string, maxBytes: number) {
  const hash = createHash("sha256"); let sizeBytes = 0;
  for await (const chunk of createReadStream(file)) { sizeBytes += chunk.length; if (sizeBytes > maxBytes) throw new DomainError(422, "INVALID_INPUT", "备份超过配置的大小限额"); hash.update(chunk); }
  return { sizeBytes, sha256: hash.digest("hex") };
}
type Client = Pick<ReturnType<typeof db>, "$transaction">;
export async function buildBackupBundle(backupId: string, token: string, config: BackupBundleConfig, tools: BackupTools, client: Client = db(), store?: ObjectStore) {
  if (!path.isAbsolute(config.root) || !/^[a-f0-9-]{36}$/.test(backupId) || !/^[a-f0-9-]{36}$/.test(token)) throw new DomainError(503, "SERVICE_UNAVAILABLE", "备份目录配置不正确");
  const directory = path.join(config.root, backupId, token); await mkdir(directory, { recursive: true, mode: 0o700 });
  // Acquire protection before exporting the MVCC snapshot. Future physical GC takes the exclusive lock.
  return client.$transaction(async guard => {
    await guard.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${"media:gc"}, 0))::text`;
    return client.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`; await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
      const [snapshot] = await tx.$queryRaw<{ snapshotId: string; capturedAt: Date }[]>`SELECT pg_export_snapshot() AS "snapshotId", transaction_timestamp() AS "capturedAt"`;
      const [counts] = await tx.$queryRaw<{ contents: bigint; content_revisions: bigint; media: bigint; categories: bigint; tags: bigint; admin_users: bigint }[]>`SELECT (SELECT count(*) FROM contents) AS contents, (SELECT count(*) FROM content_revisions) AS content_revisions, (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM categories) AS categories, (SELECT count(*) FROM tags) AS tags, (SELECT count(*) FROM admin_users) AS admin_users`;
      const rowCounts = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
      const dump = path.join(directory, "database.dump"); await tools.dump(snapshot.snapshotId, dump);
      const dumpInfo = await hashFile(dump, config.maxBytes);
      const files: { path: string; storageKey?: string; sizeBytes: number; sha256: string }[] = [{ path: "database.dump", ...dumpInfo }]; let totalBytes = dumpInfo.sizeBytes;
      const copy = async (key: string, name: string, size: bigint, digest?: string) => {
        if (size < 1n || size > BigInt(imageLimits.bytes) || size > BigInt(config.maxBytes - totalBytes)) throw new DomainError(422, "INVALID_INPUT", "媒体超过备份限额");
        const bytes = await (store || objectStore()).get(key, Number(size)), sha256 = checksum(bytes);
        if (BigInt(bytes.length) !== size || digest && sha256 !== digest) throw new DomainError(503, "SERVICE_UNAVAILABLE", "备份媒体校验失败");
        const file = path.join(directory, ...name.split("/")); await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); totalBytes += bytes.length; files.push({ path: name, storageKey: key, sizeBytes: bytes.length, sha256 });
      };
      let after: string | undefined;
      while (true) {
        const media = await tx.media.findMany({ where: { ...(after ? { id: { gt: after } } : {}), OR: [{ deletedAt: null }, { draftMedia_media: { some: {} } }, { revisionMedia_media: { some: {} } }, { contentMedia_media: { some: {} } }] }, select: { id: true, storageKey: true, sizeBytes: true, checksumSha256: true }, orderBy: { id: "asc" }, take: 20 });
        for (const item of media) {
          await copy(item.storageKey, `media/${item.id}/original`, item.sizeBytes, item.checksumSha256);
          let variantAfter: string | undefined;
          while (true) {
            const variants = await tx.mediaVariant.findMany({ where: { mediaId: item.id, isActive: true, ...(variantAfter ? { id: { gt: variantAfter } } : {}) }, select: { id: true, storageKey: true, sizeBytes: true }, orderBy: { id: "asc" }, take: 20 });
            for (const variant of variants) { const digest = /-([a-f0-9]{64})\.webp$/.exec(variant.storageKey)?.[1]; if (!digest) throw new DomainError(503, "SERVICE_UNAVAILABLE", "派生媒体摘要不存在"); await copy(variant.storageKey, `media/${item.id}/variants/${variant.id}`, variant.sizeBytes, digest); }
            if (variants.length < 20) break; variantAfter = variants.at(-1)!.id;
          }
        }
        if (media.length < 20) break; after = media.at(-1)!.id;
      }
      await tools.checkDump(dump);
      for (const entry of files) { const verified = await hashFile(path.join(directory, ...entry.path.split("/")), entry.sizeBytes); if (verified.sizeBytes !== entry.sizeBytes || verified.sha256 !== entry.sha256) throw new Error("Backup file verification failed"); }
      const manifest = { schemaVersion: 1, backupId, snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt.toISOString(), databaseFormat: "PostgreSQL18-custom", rowCounts, files };
      const bytes = Buffer.from(JSON.stringify(manifest, null, 2)); if (totalBytes + bytes.length > config.maxBytes) throw new DomainError(422, "INVALID_INPUT", "备份清单超过限额");
      await writeFile(path.join(directory, "manifest.json"), bytes, { flag: "wx", mode: 0o600 }); return { directory, manifestPath: path.join(directory, "manifest.json"), checksum: checksum(bytes), sizeBytes: BigInt(totalBytes + bytes.length) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: config.timeoutMs });
  }, { timeout: config.timeoutMs + 10000 });
}

const BackupManifest = z.object({ schemaVersion: z.literal(1), backupId: z.uuid(), snapshotId: z.string(), capturedAt: z.iso.datetime(), databaseFormat: z.literal("PostgreSQL18-custom"), rowCounts: z.record(z.string(), z.number().int().nonnegative()), files: z.array(z.object({ path: z.string(), storageKey: z.string().optional(), sizeBytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })) });
export async function verifyBackupBundle(directory: string, maxBytes: number) {
  const manifestPath = path.join(directory, "manifest.json"), manifestInfo = await hashFile(manifestPath, maxBytes), manifest = BackupManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  let total = manifestInfo.sizeBytes; const names = new Set<string>();
  for (const entry of manifest.files) {
    const file = path.resolve(directory, entry.path);
    if (!file.startsWith(path.resolve(directory) + path.sep) || names.has(entry.path)) throw new Error("Invalid backup entry"); names.add(entry.path);
    const info = await hashFile(file, Math.min(maxBytes - total, entry.sizeBytes));
    if (info.sizeBytes !== entry.sizeBytes || info.sha256 !== entry.sha256) throw new Error("Backup checksum mismatch"); total += info.sizeBytes;
  }
  if (!names.has("database.dump")) throw new Error("Database dump missing");
  return { directory, manifestPath, checksum: manifestInfo.sha256, sizeBytes: BigInt(total), manifest };
}
