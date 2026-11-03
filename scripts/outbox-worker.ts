import { loadEnvConfig } from "@next/env";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/lib/db";
import { runOutboxEvent } from "../src/lib/outbox-worker";
async function main() {
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: npm run worker:outbox -- [--once]. Reconciles live content search and dispatches MEDIA_DELETED to durable MEDIA_GC jobs; does not delete objects. Requires an existing authorized database.");
} else if (args.some(arg => arg !== "--once") || args.length > 1) {
  console.error("Unknown or duplicate argument. Use --help."); process.exitCode = 1;
} else {
  loadEnvConfig(process.cwd());
  let stopping = false;
  const controller = new AbortController();
  const stop = () => { stopping = true; controller.abort(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    while (!stopping) {
      const worked = await runOutboxEvent();
      if (args.includes("--once")) break;
      if (!worked && !stopping) await setTimeout(5000, undefined, { signal: controller.signal }).catch(error => { if (error.name !== "AbortError") throw error; });
    }
  } catch { console.error("Outbox worker stopped: check the existing database and event queue. No payload or credentials are logged."); process.exitCode = 1; }
  finally {
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    if (process.env.DATABASE_URL) await db().$disconnect();
  }
}

}
void main().catch(() => { console.error("Outbox worker shutdown failed. No credentials are logged."); process.exitCode = 1; });
