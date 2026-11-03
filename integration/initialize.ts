import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { S3Client, ListBucketsCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { prepareAdministrator, initializeAdministrator } from "../src/lib/admin-initialization";
import { totp } from "../src/lib/crypto";
import { db } from "../src/lib/db";
import { runCommand } from "../src/lib/process-runner";
async function main() {
  if (process.env.PERSONAL_SPACE_INTEGRATION !== "true" || !process.env.DATABASE_URL?.includes("127.0.0.1:15432/personal_space_test")) throw new Error("Isolated integration database required");
  const file = "work/integration/secrets.json", secrets = JSON.parse(await readFile(file,"utf8")), owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await owner.connect();
  try {
    const role = await owner.query("SELECT 1 FROM pg_roles WHERE rolname='ps_app'");
    if (!role.rowCount) await owner.query(`CREATE ROLE ps_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${secrets.appPassword}'`);
    await owner.query("GRANT USAGE ON SCHEMA public TO ps_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ps_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ps_app; REVOKE UPDATE,DELETE ON content_revisions,revision_media,revision_categories,revision_tags,audit_logs FROM ps_app; REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM ps_app");
    const restore = await owner.query("SELECT 1 FROM pg_database WHERE datname='personal_space_restore'"); if (!restore.rowCount) await owner.query("CREATE DATABASE personal_space_restore OWNER ps_owner");
  } finally { await owner.end(); }
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: secrets.storageAccessKey, secretAccessKey: secrets.storageSecretKey } });
  const buckets = await s3.send(new ListBucketsCommand({}));
  for (const name of ["ps-media","ps-backup","ps-restore"]) if (!buckets.Buckets?.some(bucket => bucket.Name === name)) await s3.send(new CreateBucketCommand({ Bucket: name })); s3.destroy();
  try { await runCommand(process.env.RESTIC_PATH!, ["cat","config"], { timeoutMs: 30000 }); } catch { await runCommand(process.env.RESTIC_PATH!, ["init"], { timeoutMs: 30000 }); }
  const existing = await db().adminUser.findFirst();
  if (!existing) {
    const prepared = await prepareAdministrator("integration-owner", secrets.testPassword); secrets.testSecret = prepared.secret; await writeFile(file,JSON.stringify(secrets),{mode:0o600});
    const result = await initializeAdministrator(prepared, totp(prepared.secret,Math.floor(Date.now()/30000))); secrets.testRecoveryCodes = result.recoveryCodes; await writeFile(file,JSON.stringify(secrets),{mode:0o600});
  } else if (existing.username !== "integration-owner" || !secrets.testSecret) throw new Error("Unknown existing administrator");
  console.log("Isolated runtime role, three private test buckets and MFA-enabled integration administrator are initialized. Credentials remain in the ignored local file.");
}
void main().catch(error => { console.error("Integration initialization failed:", error instanceof Error ? error.message.replace(/postgresql:\/\/[^ ]+/g,"[connection]") : "unknown"); process.exitCode=1; }).finally(async()=>{if(process.env.DATABASE_URL)await db().$disconnect();});
