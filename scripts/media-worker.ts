import { loadEnvConfig } from "@next/env";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/lib/db";
import { runMediaJob } from "../src/lib/media-worker";
async function main() {
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: npm run worker:media -- [--once]. Requires an existing authorized database and private storage."); return;
}
if (args.some(arg => arg !== "--once") || args.length > 1) {
  console.error("Unknown or duplicate argument. Use --help."); process.exitCode = 1; return;
}
loadEnvConfig(process.cwd());
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
try {
  do { const worked = await runMediaJob(); if (process.argv.includes("--once")) break; if (!worked) await setTimeout(5000); } while (!stopping);
} catch { console.error("Media worker stopped: check database and private storage configuration. No credentials are logged."); process.exitCode = 1; }
finally { if (process.env.DATABASE_URL) await db().$disconnect(); }

}
void main().catch(() => { console.error("Media worker shutdown failed. No credentials are logged."); process.exitCode = 1; });
