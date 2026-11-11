import nextEnv from "@next/env";
import { Client } from "pg";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

// Only the isolated restore target is cleared. This script never connects to the
// source DATABASE_URL or the source media bucket.
nextEnv.loadEnvConfig(process.cwd());

if (process.env.PERSONAL_SPACE_INTEGRATION !== "true") throw new Error("Isolated integration environment required");
const target = process.env.RESTORE_DATABASE_URL;
const source = process.env.DATABASE_URL;
if (!target || !source) throw new Error("Restore target is not configured");
const targetUrl = new URL(target);
if (targetUrl.hostname !== "127.0.0.1" || targetUrl.port !== "15432" || targetUrl.pathname !== "/personal_space_restore") {
  throw new Error("Refusing to reset a database that is not the isolated restore target");
}

const bucket = process.env.RESTORE_S3_BUCKET;
const endpoint = process.env.RESTORE_S3_ENDPOINT;
const region = process.env.RESTORE_S3_REGION;
const accessKeyId = process.env.RESTORE_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.RESTORE_S3_SECRET_ACCESS_KEY;
if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error("Restore storage is not configured");
if (!endpoint || new URL(endpoint).origin !== "https://127.0.0.1:19000" || bucket !== "ps-restore") {
  throw new Error("Refusing to clear storage outside the isolated local restore bucket");
}
if (!process.env.S3_BUCKET || bucket === process.env.S3_BUCKET) {
  throw new Error("Restore bucket must differ from the configured source bucket");
}
const sourceUrl = new URL(source);
if (sourceUrl.hostname === targetUrl.hostname && (sourceUrl.port || "5432") === targetUrl.port && decodeURIComponent(sourceUrl.pathname) === targetUrl.pathname) {
  throw new Error("Restore database must differ from the source database");
}

const client = new Client({ connectionString: target });
await client.connect();
try {
  await client.query("BEGIN; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; COMMIT");
  const empty = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  if (empty.rows[0].count !== 0) throw new Error("Restore database did not become empty");
} finally {
  await client.end();
}

const s3 = new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle: process.env.RESTORE_S3_FORCE_PATH_STYLE === "true", credentials: { accessKeyId, secretAccessKey } });
let removed = 0, token;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
  const objects = (page.Contents || []).flatMap(item => item.Key ? [{ Key: item.Key }] : []);
  if (objects.length) {
    const result = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
    removed += objects.length - (result.Errors?.length || 0);
    if (result.Errors?.length) throw new Error(`Could not clear ${result.Errors.length} restore objects`);
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);
s3.destroy();

console.log(`Isolated restore target reset: public schema recreated, ${removed} private test object(s) removed.`);