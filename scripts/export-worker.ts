import { loadEnvConfig } from "@next/env";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/lib/db";
import { exportRuntime } from "../src/lib/export-artifacts";
import { runExportJob } from "../src/lib/export-worker";
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log("Usage: npm run worker:export -- [--once]. Requires an existing database and a configured private EXPORT_DIRECTORY."); return; }
  if (args.length > 1 || args.some(arg => arg !== "--once")) { process.exitCode = 1; console.error("Use --help for valid arguments."); return; }
  loadEnvConfig(process.cwd()); const runtime = exportRuntime(), controller = new AbortController(); let stopping = false;
  const stop = () => { stopping = true; controller.abort(); }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try { while (!stopping) { const worked = await runExportJob(runtime.store, runtime.config); if (args.includes("--once")) break; if (!worked && !stopping) await setTimeout(5000, undefined, { signal: controller.signal }).catch(error => { if (error.name !== "AbortError") throw error; }); } }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); if (process.env.DATABASE_URL) await db().$disconnect(); }
}
void main().catch(() => { console.error("Export worker stopped. Check database, private directory and storage configuration."); process.exitCode = 1; });
