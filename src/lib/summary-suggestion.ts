import { z } from "zod";
import { DomainError } from "./domain";

export const summaryInput = z.strictObject({
  contentId: z.uuid(),
  title: z.string().trim().min(1).max(240),
  markdown: z.string().trim().min(1).max(20_000),
});
export type SummaryInput = z.infer<typeof summaryInput>;
const output = z.object({ summary: z.string().trim().min(1).max(500) });

export async function suggestSummary(
  input: SummaryInput,
  config: { endpoint: URL; token?: string; signal?: AbortSignal; timeoutMs?: number },
  send: typeof fetch = fetch,
) {
  const signal = AbortSignal.timeout(config.timeoutMs ?? 15_000);
  try {
    const response = await send(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      body: JSON.stringify({ title: input.title, markdown: input.markdown, language: "zh-CN", maxCharacters: 500 }),
      signal: config.signal ? AbortSignal.any([signal, config.signal]) : signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error("AI service returned an error");
    return output.parse(await response.json());
  } catch {
    throw new DomainError(503, "SERVICE_UNAVAILABLE", signal.aborted ? "生成摘要超时，请稍后重试" : "暂时无法生成摘要，你可以继续手写");
  }
}
