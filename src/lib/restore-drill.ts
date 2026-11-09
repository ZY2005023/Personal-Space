import path from "node:path";
import { readFile } from "node:fs/promises";
import { Client as PgClient } from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { db } from "./db";
import { DomainError } from "./domain";
import { verifyBackupBundle } from "./backup-pipeline";
import { postgresToolEnv } from "./backup-runtime";
import { runCommand } from "./process-runner";
import { PrivateS3Store, checksum } from "./object-store";
export function databaseIdentity(connection: string) { const url = new URL(connection); return `${url.hostname.toLowerCase()}:${url.port || "5432"}${decodeURIComponent(url.pathname)}`; }
export async function executeRestoreDrill(directory: string) {
  const target = process.env.RESTORE_DATABASE_URL, source = process.env.DATABASE_URL;
  if (!target || !source || databaseIdentity(target) === databaseIdentity(source)) throw new DomainError(422, "INVALID_INPUT", "恢复演练必须使用独立的现有空数据库");
  const bucket = process.env.RESTORE_S3_BUCKET, endpoint = process.env.RESTORE_S3_ENDPOINT, region = process.env.RESTORE_S3_REGION, accessKeyId = process.env.RESTORE_S3_ACCESS_KEY_ID, secretAccessKey = process.env.RESTORE_S3_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey || (process.env.S3_BUCKET && bucket === process.env.S3_BUCKET)) throw new DomainError(422, "INVALID_INPUT", "恢复演练必须配置独立的现有私有存储桶");
  if (!process.env.S3_BUCKET) throw new DomainError(503, "SERVICE_UNAVAILABLE", "S3_BUCKET 未配置，无法验证演练桶与生产桶的隔离");
  if (endpoint && new URL(endpoint).protocol !== "https:") throw new Error("Restore storage requires HTTPS");
  const maxBytes = Number(process.env.BACKUP_MAX_BYTES || 10 * 1024 ** 3), bundle = await verifyBackupBundle(directory, maxBytes), main = db();
  const backup = await main.backupRun.findUnique({ where: { id: bundle.manifest.backupId } }); if (!backup || backup.checksum !== bundle.checksum) throw new Error("Backup manifest does not match its record");
  const targetClient = new PgClient({ connectionString: target, connectionTimeoutMillis: 10000, query_timeout: 30000 }); await targetClient.connect(); let drillId: string | undefined;
  try {
    const server = await targetClient.query("SHOW server_version_num"); if (Math.floor(Number(server.rows[0].server_version_num) / 10000) !== 18) throw new Error("Restore target must run PostgreSQL 18");
    const empty = await targetClient.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    if (empty.rows[0].count !== 0) throw new Error("Restore target must be empty");
    const version = await runCommand(process.env.PG_RESTORE_PATH || "pg_restore", ["--version"], { timeoutMs: 10000 }); if (!/PostgreSQL\) 18\./.test(version)) throw new Error("PostgreSQL 18 restore tool required");
    const drill = await main.restoreDrill.create({ data: { backupRunId: backup.id, status: "RUNNING", startedAt: new Date(), verificationSummary: { stage: "RESTORING" } } }); drillId = drill.id;
    await runCommand(process.env.PG_RESTORE_PATH || "pg_restore", ["--single-transaction", "--no-owner", "--no-acl", "--exit-on-error", "--no-password", "--dbname", decodeURIComponent(new URL(target).pathname.slice(1)), path.join(directory, "database.dump")], { env: postgresToolEnv(target), timeoutMs: Number(process.env.BACKUP_TIMEOUT_SECONDS || 1800) * 1000 });
    const storage = new PrivateS3Store(new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle: process.env.RESTORE_S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId, secretAccessKey } }), bucket);
    for (const entry of bundle.manifest.files) if (entry.storageKey) {
      const bytes = await readFile(path.join(directory, ...entry.path.split("/")));
      let mimeType = "image/webp";
      if (entry.storageKey.startsWith("originals/")) { const result = await targetClient.query("SELECT mime_type FROM media WHERE storage_key = $1 LIMIT 1", [entry.storageKey]); if (!result.rowCount) throw new Error("Restored original metadata missing"); mimeType = result.rows[0].mime_type; }
      await storage.putImmutable(entry.storageKey, bytes, mimeType); const verified = await storage.get(entry.storageKey, entry.sizeBytes); if (verified.length !== bytes.length || checksum(verified) !== entry.sha256) throw new Error("Restored media verification failed");
    }
    const counts: Record<string, number> = {};
    for (const table of ["contents", "content_revisions", "media", "categories", "tags", "admin_users"] as const) { const result = await targetClient.query(`SELECT count(*)::text AS count FROM ${table}`); counts[table] = Number(result.rows[0].count); if (counts[table] !== bundle.manifest.rowCounts[table]) throw new Error("Restored row count mismatch"); }
    const invalid = await targetClient.query("SELECT count(*)::int AS count FROM contents c LEFT JOIN content_drafts d ON d.content_id = c.id LEFT JOIN content_revisions r ON r.content_id = c.id AND r.id = c.published_revision_id WHERE d.content_id IS NULL OR (c.published_revision_id IS NOT NULL AND r.id IS NULL) OR (c.publication_state = 'PUBLISHED' AND (c.published_revision_id IS NULL OR r.revision_kind <> 'PUBLISHED'))"); if (invalid.rows[0].count !== 0) throw new Error("Restored content links invalid");
    await main.restoreDrill.update({ where: { id: drillId }, data: { status: "PASSED", completedAt: new Date(), verificationSummary: { counts, mediaVerified: true, manifestSha256: bundle.checksum }, notes: "隔离数据库与私有媒体恢复、计数和内容引用检查通过" } }); return { drillId, counts };
  } catch (error) { if (drillId) await main.restoreDrill.update({ where: { id: drillId }, data: { status: "FAILED", completedAt: new Date(), verificationSummary: { stage: "FAILED" }, notes: "恢复演练未通过，请检查本机工具与目标服务日志" } }); throw error; }
  finally { await targetClient.end(); }
}
