import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.PERSONAL_SPACE_INTEGRATION !== "true") throw new Error("Isolated integration environment required");
if (!process.env.RESTORE_DATABASE_URL || !process.env.RESTORE_S3_BUCKET || !process.env.DATABASE_URL) throw new Error("Restore targets are not configured");

// Mirror deploy/migrate.sh: the restored application runs as the least-privilege role.
const owner = new Client({ connectionString: process.env.RESTORE_DATABASE_URL });
await owner.connect();
try {
  await owner.query(`GRANT USAGE ON SCHEMA public TO ps_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ps_app;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ps_app;
    REVOKE UPDATE,DELETE ON content_revisions,revision_media,revision_categories,revision_tags,audit_logs FROM ps_app;
    REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM ps_app;`);
} finally { await owner.end(); }
const appDatabase = new URL(process.env.DATABASE_URL);
appDatabase.pathname = "/personal_space_restore";

const port = process.env.RESTORED_APP_PORT || "3002";
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: appDatabase.toString(),
  S3_BUCKET: process.env.RESTORE_S3_BUCKET,
  S3_REGION: process.env.RESTORE_S3_REGION,
  S3_ACCESS_KEY_ID: process.env.RESTORE_S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.RESTORE_S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT: process.env.RESTORE_S3_ENDPOINT,
  S3_FORCE_PATH_STYLE: process.env.RESTORE_S3_FORCE_PATH_STYLE || "false",
  AUTH_URL: origin,
  NEXTAUTH_URL: origin,
  PORT: port,
  PREVIEW_CONTENT: "false",
  INTEGRATION_BASE_URL: origin,
  INTEGRATION_CREDENTIAL_FILE: "work/integration/backup-login.json",
};

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "-p", port], { env, stdio: "inherit", windowsHide: true });
let ready = false;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(origin + "/health/ready")).ok) { ready = true; break; } } catch { /* starting */ }
    await delay(500);
  }
  if (!ready) throw new Error("Restored application did not become ready");
  const test = spawn(process.execPath, ["--import", "tsx", "integration/test-restored.ts"], { env, stdio: "inherit", windowsHide: true });
  const code = await new Promise(resolve => test.on("exit", resolve));
  if (code !== 0) process.exitCode = code || 1;
} finally {
  server.kill();
  await delay(500);
}