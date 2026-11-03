import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { verifyBackupBundle } from "../src/lib/backup-pipeline";
import { executeRestoreDrill } from "../src/lib/restore-drill";
import { db } from "../src/lib/db";
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) { console.log("Usage: npm run backup:drill -- --bundle ABSOLUTE_DIRECTORY [--execute]. Default only verifies files. --execute restores into the explicitly configured existing empty RESTORE_DATABASE_URL and independent RESTORE_S3_BUCKET; never creates a database or bucket."); return; }
  const index = args.indexOf("--bundle"), directory = args[index + 1]; if (index !== 0 || !directory || !path.isAbsolute(directory) || args.length > 3 || args.length === 3 && args[2] !== "--execute") throw new Error("Invalid arguments");
  loadEnvConfig(process.cwd());
  if (!args.includes("--execute")) { const bundle = await verifyBackupBundle(directory, Number(process.env.BACKUP_MAX_BYTES || 10 * 1024 ** 3)); console.log(JSON.stringify({ verified: true, files: bundle.manifest.files.length, sha256: bundle.checksum })); return; }
  try { const result = await executeRestoreDrill(directory); console.log(JSON.stringify(result)); } finally { if (process.env.DATABASE_URL) await db().$disconnect(); }
}
void main().catch(() => { console.error("Restore drill failed. Check backup files and the explicitly configured isolated targets. No credentials are logged."); process.exitCode = 1; });
