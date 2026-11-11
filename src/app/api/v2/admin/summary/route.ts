import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain";
import { ok, problem, readJson, requireAdmin } from "@/lib/http";
import { suggestSummary, summaryInput } from "@/lib/summary-suggestion";

export async function POST(request: Request) {
  try {
    const adminId = await requireAdmin(request);
    const input = summaryInput.parse(await readJson(request));
    const article = await db().content.findFirst({
      where: { id: input.contentId, ownerId: adminId, type: "ARTICLE", deletedAt: null },
      select: { id: true },
    });
    if (!article) throw new DomainError(404, "NOT_FOUND", "文章不存在");
    const url = process.env.AI_SUMMARY_ENDPOINT;
    if (!url) throw new DomainError(503, "SERVICE_UNAVAILABLE", "AI 摘要服务尚未配置，你可以继续手写");
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1")) {
      throw new DomainError(503, "SERVICE_UNAVAILABLE", "AI 摘要服务地址无效");
    }
    const limit = Number(process.env.AI_SUMMARY_DAILY_LIMIT || 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new DomainError(503, "SERVICE_UNAVAILABLE", "AI 摘要额度配置无效");
    const used = await db().$queryRaw<{ requests: number }[]>`
      INSERT INTO ai_summary_usage (usage_day, requests) VALUES ((now() AT TIME ZONE 'Asia/Hong_Kong')::date, 1)
      ON CONFLICT (usage_day) DO UPDATE SET requests = ai_summary_usage.requests + 1
      WHERE ai_summary_usage.requests < ${limit} RETURNING requests`;
    if (!used.length) throw new DomainError(429, "RATE_LIMITED", "今天的摘要生成次数已用完");
    return ok(await suggestSummary(input, { endpoint, token: process.env.AI_SUMMARY_TOKEN, signal: request.signal }));
  } catch (error) { return problem(error); }
}
