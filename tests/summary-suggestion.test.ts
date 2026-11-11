import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestSummary, summaryInput } from "../src/lib/summary-suggestion";
import { DomainError } from "../src/lib/domain";

const input = { contentId: "11111111-1111-4111-8111-111111111111", title: "标题", markdown: "一段文章正文" };
const endpoint = new URL("https://example.invalid/summary");

test("summary provider only receives the selected article text", async () => {
  const result = await suggestSummary(input, { endpoint }, async (url, options) => {
    assert.equal(url, endpoint);
    assert.deepEqual(JSON.parse(String(options?.body)), {
      title: input.title, markdown: input.markdown, language: "zh-CN", maxCharacters: 500,
    });
    assert.equal(options?.redirect, "error");
    return Response.json({ summary: " 一段摘要 " });
  });
  assert.deepEqual(result, { summary: "一段摘要" });
  assert.equal(summaryInput.safeParse({ ...input, attachment: "unexpected" }).success, false);
});

test("provider errors and timeouts surface a safe failure", async () => {
  await assert.rejects(suggestSummary(input, { endpoint }, async () => new Response("private diagnostic", { status: 502 })),
    (error: unknown) => error instanceof DomainError && error.status === 503 && !error.message.includes("private diagnostic"));
  await assert.rejects(suggestSummary(input, { endpoint, timeoutMs: 1 }, async (_url, options) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    options?.signal?.throwIfAborted();
    return Response.json({ summary: "too late" });
  }), /生成摘要超时/);
});
