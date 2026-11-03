import { loadEnvConfig } from "@next/env";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/lib/db";
import { runMediaGc } from "../src/lib/media-gc";
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log("Usage: npm run worker:gc -- [--once]. Physical cleanup of unreferenced deleted media requires an explicitly configured MEDIA_GC_GRACE_SECONDS."); return; }
  if (args.length > 1 || args.some(arg => arg !== "--once")) { process.exitCode = 1; console.error("Use --help for valid arguments."); return; }
  loadEnvConfig(process.cwd()); const grace = Number(process.env.MEDIA_GC_GRACE_SECONDS) * 1000;
  if (!Number.isSafeInteger(grace) || grace < 1) throw new Error("Configure cleanup grace period first");
  let stopping = false; const controller = new AbortController(), stop = () => { stopping = true; controller.abort(); }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try { while (!stopping) { const worked = await runMediaGc(grace); if (args.includes("--once")) break; if (!worked && !stopping) await setTimeout(5000, undefined, { signal: controller.signal }).catch(error => { if (error.name !== "AbortError") throw error; }); } }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); if (process.env.DATABASE_URL) await db().$disconnect(); }
}
void main().catch(() => { console.error("GC worker stopped. Check configured grace period, database and private storage."); process.exitCode = 1; });
