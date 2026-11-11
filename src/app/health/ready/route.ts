import { db } from "@/lib/db";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configurationIssue() {
  if (!process.env.DATABASE_URL) return "DATABASE_URL";
  if (!process.env.AUTH_SECRET || Buffer.byteLength(process.env.AUTH_SECRET) < 32) return "AUTH_SECRET";
  const totp = Buffer.from(process.env.TOTP_ENCRYPTION_KEY || "", "base64");
  if (totp.length !== 32 || totp.toString("base64") !== process.env.TOTP_ENCRYPTION_KEY) return "TOTP_ENCRYPTION_KEY";
  if (process.env.NODE_ENV === "production" && !process.env.CURSOR_SECRET) return "CURSOR_SECRET";
  if (!process.env.S3_BUCKET || !process.env.S3_REGION || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) return "S3";
  return null;
}

export async function GET() {
  const issue = configurationIssue();
  if (issue) {
    log("error", "health.ready", { ready: false, issue });
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const [row] = await db().$queryRaw<{ trgm: bigint; migrations: bigint; tables: bigint }[]>`
      SELECT
        (SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm') AS trgm,
        (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
        (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN
          ('admin_users','contents','content_drafts','content_revisions','content_publications','content_routes',
           'media','content_search_documents','operation_jobs','outbox_events','backup_runs',
           'interest_topics','interest_topic_items','ai_summary_usage')) AS tables`;
    const ready = Number(row?.trgm) >= 1 && Number(row?.migrations) >= 4 && Number(row?.tables) === 14;
    if (!ready) {
      log("error", "health.ready", { ready: false, issue: "schema", trgm: Number(row?.trgm), migrations: Number(row?.migrations), tables: Number(row?.tables) });
      return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    log("error", "health.ready", { ready: false, issue: "database" });
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}