import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
const root = process.cwd(), local = path.join(root, "work", "integration"); mkdirSync(local, { recursive: true });
const docker = process.env.DOCKER_BINARY || (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA, "Programs/DockerDesktop/resources/bin/docker.exe") : "docker");
const run = args => execFileSync(docker, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const privateFile = path.join(local, "secrets.json");
let secrets;
if (existsSync(privateFile)) secrets = JSON.parse(readFileSync(privateFile, "utf8"));
else { secrets = { ownerPassword: randomBytes(24).toString("hex"), appPassword: randomBytes(24).toString("hex"), storageAccessKey: "ps-integration-root", storageSecretKey: randomBytes(24).toString("hex"), authSecret: randomBytes(32).toString("hex"), cursorSecret: randomBytes(32).toString("hex"), totpKey: randomBytes(32).toString("base64"), testPassword: randomBytes(24).toString("hex"), resticPassword: randomBytes(32).toString("hex") }; writeFileSync(privateFile, JSON.stringify(secrets), { mode: 0o600 }); }
const certs = path.join(local, "certs"); mkdirSync(certs, { recursive: true });
if (!existsSync(path.join(certs, "public.crt"))) execFileSync(process.env.OPENSSL_BINARY || "C:/Program Files/Git/usr/bin/openssl.exe", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(certs, "private.key"), "-out", path.join(certs, "public.crt"), "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,DNS:storage,IP:127.0.0.1"], { windowsHide: true, stdio: "pipe" });
const pgEnv = path.join(local, "postgres.env"), storageEnv = path.join(local, "storage.env");
writeFileSync(pgEnv, `POSTGRES_USER=ps_owner\nPOSTGRES_PASSWORD=${secrets.ownerPassword}\nPOSTGRES_DB=personal_space_test\n`, { mode: 0o600 });
writeFileSync(storageEnv, `MINIO_ROOT_USER=${secrets.storageAccessKey}\nMINIO_ROOT_PASSWORD=${secrets.storageSecretKey}\n`, { mode: 0o600 });
try { run(["network", "inspect", "personal-space-integration"]); } catch { run(["network", "create", "personal-space-integration"]); }
function ensure(name, args) {
  try { const label = run(["inspect", "--format", '{{index .Config.Labels "com.personal-space.integration"}}', name]).trim(); if (label !== "true") throw new Error("Name already belongs to another container"); run(["start", name]); }
  catch (error) { if (!/no such/i.test(String(error.message) + String(error.stderr || ""))) throw error; run(["run", "-d", "--name", name, "--label", "com.personal-space.integration=true", ...args]); }
}
const mount = `type=bind,source=${local},target=/integration`;
ensure("personal-space-integration-postgres", ["--network", "personal-space-integration", "--network-alias", "database", "-p", "127.0.0.1:15432:5432", "--env-file", pgEnv, "--mount", mount, "--mount", "type=volume,source=personal-space-integration-postgres,target=/var/lib/postgresql", "personal-space-integration-database:local"]);
ensure("personal-space-integration-storage", ["--network", "personal-space-integration", "--network-alias", "storage", "-p", "127.0.0.1:19000:9000", "-p", "127.0.0.1:19001:9001", "--env-file", storageEnv, "--mount", `type=bind,source=${certs},target=/certs,readonly`, "--mount", "type=volume,source=personal-space-integration-storage,target=/data", "personal-space-integration-storage:local", "--certs-dir", "/certs", "--quiet", "server", "/data", "--console-address", ":9001"]);
const envPath = path.join(root, ".env.local");
if (existsSync(envPath) && !readFileSync(envPath, "utf8").includes("PERSONAL_SPACE_INTEGRATION=true")) throw new Error("Existing environment is not this isolated integration environment");
const cleanPath = value => value.replaceAll("\\", "/");
const env = { PERSONAL_SPACE_INTEGRATION: "true", DATABASE_URL: `postgresql://ps_app:${secrets.appPassword}@127.0.0.1:15432/personal_space_test`, MIGRATION_DATABASE_URL: `postgresql://ps_owner:${secrets.ownerPassword}@127.0.0.1:15432/personal_space_test`, AUTH_SECRET: secrets.authSecret, CURSOR_SECRET: secrets.cursorSecret, TOTP_ENCRYPTION_KEY: secrets.totpKey, AUTH_URL: "http://127.0.0.1:3000", PREVIEW_CONTENT: "false", NODE_EXTRA_CA_CERTS: cleanPath(path.join(certs,"public.crt")), S3_BUCKET: "ps-media", S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: secrets.storageAccessKey, S3_SECRET_ACCESS_KEY: secrets.storageSecretKey, S3_ENDPOINT: "https://127.0.0.1:19000", S3_FORCE_PATH_STYLE: "true", EXPORT_DIRECTORY: cleanPath(path.join(local,"exports")), EXPORT_MAX_BYTES: "67108864", EXPORT_TTL_SECONDS: "86400", BACKUP_DIRECTORY: cleanPath(path.join(local,"backups")), BACKUP_MAX_BYTES: "1073741824", BACKUP_TIMEOUT_SECONDS: "300", BACKUP_AUTOMATIC: "false", PG_DUMP_PATH: cleanPath(path.join(root,"integration/pg-dump.mjs")), PG_RESTORE_PATH: cleanPath(path.join(root,"integration/pg-restore.mjs")), RESTIC_PATH: cleanPath(path.join(root,"integration/restic.mjs")), RESTIC_REPOSITORY: "s3:https://storage:9000/ps-backup", RESTIC_PASSWORD_FILE: cleanPath(path.join(local,"restic.password")), AWS_ACCESS_KEY_ID: secrets.storageAccessKey, AWS_SECRET_ACCESS_KEY: secrets.storageSecretKey, MEDIA_GC_GRACE_SECONDS: "1", RESTORE_DATABASE_URL: `postgresql://ps_owner:${secrets.ownerPassword}@127.0.0.1:15432/personal_space_restore`, RESTORE_S3_BUCKET: "ps-restore", RESTORE_S3_REGION: "us-east-1", RESTORE_S3_ACCESS_KEY_ID: secrets.storageAccessKey, RESTORE_S3_SECRET_ACCESS_KEY: secrets.storageSecretKey, RESTORE_S3_ENDPOINT: "https://127.0.0.1:19000", RESTORE_S3_FORCE_PATH_STYLE: "true" };
writeFileSync(envPath, Object.entries(env).map(([key,value]) => `${key}=${value}`).join("\n")+"\n", { mode: 0o600 });
writeFileSync(path.join(local,"restic.password"), secrets.resticPassword, { mode: 0o600 });
console.log("Isolated containers configured: PostgreSQL 127.0.0.1:15432, HTTPS S3 127.0.0.1:19000. Private configuration written; no secrets displayed.");
