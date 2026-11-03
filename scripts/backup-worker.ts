import { loadEnvConfig } from "@next/env";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/lib/db";
import { backupRuntime } from "../src/lib/backup-runtime";
import { runBackupJob } from "../src/lib/backup-worker";
import { scheduleBackups } from "../src/lib/backup-scheduler";
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log("Usage: npm run worker:backup -- [--once]. Requires an authorized database, PostgreSQL 18 tools, private BACKUP_DIRECTORY and existing restic repository."); return; }
  if (args.length > 1 || args.some(arg => arg !== "--once")) { process.exitCode = 1; console.error("Use --help for valid arguments."); return; }
  loadEnvConfig(process.cwd()); const runtime = backupRuntime(), controller = new AbortController(); let stopping = false;
  const stop = () => { stopping = true; controller.abort(); }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try { while (!stopping) { await scheduleBackups(); const worked = await runBackupJob(runtime.config, runtime.tools); if (args.includes("--once")) break; if (!worked && !stopping) await setTimeout(5000, undefined, { signal: controller.signal }).catch(error => { if (error.name !== "AbortError") throw error; }); } }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); if (process.env.DATABASE_URL) await db().$disconnect(); }
}
void main().catch(() => { console.error("Backup worker stopped. Check database, PostgreSQL tools, private directory and restic configuration."); process.exitCode = 1; });
