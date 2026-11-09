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

const client = new Client({ connectionString: target });
await client.connect();
try {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  const empty = await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  if (empty.rows[0].count !== 0) throw new Error("Restore database did not become empty");
} finally {
  await client.end();
}

const bucket = process.env.RESTORE_S3_BUCKET;
const endpoint = process.env.RESTORE_S3_ENDPOINT;
const region = process.env.RESTORE_S3_REGION;
const accessKeyId = process.env.RESTORE_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.RESTORE_S3_SECRET_ACCESS_KEY;
if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error("Restore storage is not configured");
if (endpoint && new URL(endpoint).protocol !== "https:") throw new Error("Restore storage must use HTTPS");

// Guard: refuse to clear the production bucket or any bucket outside the test convention.
const productionBucket = process.env.S3_BUCKET;
if (!productionBucket) throw new Error("S3_BUCKET (production bucket name) is not set; cannot verify restore bucket isolation");
if (bucket === productionBucket) throw new Error("RESTORE_S3_BUCKET must differ from the production S3_BUCKET; refusing to clear production storage");
// Bucket name must match the isolated test convention so a misconfigured RESTORE_S3_BUCKET
// pointing at an unrelated bucket still fails fast instead of deleting foreign data.
if (!/^ps-restore(-[\w-]+)?$/.test(bucket)) throw new Error(`RESTORE_S3_BUCKET "${bucket}" does not match the isolated test bucket naming convention (ps-restore*); refusing to clear`);

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