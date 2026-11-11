import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AuthClient, base } from "./http-client";
import { db } from "../src/lib/db";

const topicPath = "/api/v2/admin/topics";
const summaryPath = "/api/v2/admin/summary";
const requestKey = () => ({ "Idempotency-Key": randomUUID() });
async function run() {
  const client = new AuthClient();
  await client.login();
  const runId = randomUUID().slice(0, 8);
  async function article(title: string) {
    const created = (await client.json("/api/v1/admin/contents", "POST", { type: "ARTICLE", module: "KNOWLEDGE" }, 201, requestKey())).value.data;
    const url = "/api/v1/admin/contents/" + created.state.id;
    const { taxonomySnapshot: _, ...payload } = created.draft.payload;
    const draft = (await client.json(url + "/draft", "PUT", {
      ...payload, title, bodyMarkdown: "第二版联调正文", summary: "原摘要", desiredVisibility: "PUBLIC",
    }, 200, { "If-Match": created.draft.etag })).value.data;
    return { id: created.state.id as string, url, draft, state: created.state };
  }
  async function publish(item: Awaited<ReturnType<typeof article>>) {
    return (await client.json(item.url + "/publish", "POST", { expectedStateEtag: item.state.stateEtag },
      200, { ...requestKey(), "If-Match": item.draft.etag })).value.data;
  }
  const first = await article("专题甲 " + runId), second = await article("专题乙 " + runId);
  const summaryRequest = { contentId: first.id, title: first.draft.payload.title, markdown: first.draft.payload.bodyMarkdown };
  assert.equal((await fetch(base + summaryPath, { method: "POST" })).status, 401);
  const suggestion = (await client.json(summaryPath, "POST", summaryRequest)).value.data.summary;
  assert.equal(suggestion, "隔离测试摘要建议");
  const stored = (await client.json(first.url + "/draft")).value.data;
  assert.equal(stored.payload.summary, "原摘要");
  const { taxonomySnapshot: _, ...payload } = stored.payload;
  first.draft = (await client.json(first.url + "/draft", "PUT", { ...payload, summary: suggestion }, 200, { "If-Match": stored.etag })).value.data;
  assert.equal((await fetch(base + "/api/v1/contents/" + first.id)).status, 404);
  const published = await publish(first);
  await publish(second);
  const live = await (await fetch(base + "/api/v1/contents/" + first.id)).json();
  assert.equal(live.data.payload.summary, suggestion);
  console.log("Passed: authenticated summary suggestion, explicit draft save, and publication");

  const topic = { slug: "integration-topic-" + runId, title: "第二版专题 " + runId, intro: "公开专题联调", isPublic: true, contentIds: [first.id, second.id] };
  const { id } = (await client.json(topicPath, "POST", topic, 201)).value.data;
  const path = base + "/interests/" + topic.slug;
  assert.equal((await fetch(path)).status, 404);
  await client.json(topicPath, "PUT", { ...topic, id, version: 1 });
  let page = await (await fetch(path)).text();
  assert.ok(page.indexOf("专题甲 " + runId) < page.indexOf("专题乙 " + runId));
  await client.json(topicPath, "PUT", { ...topic, id, version: 2, contentIds: [second.id, first.id] });
  page = await (await fetch(path)).text();
  assert.ok(page.includes("专题甲 " + runId) && page.includes("专题乙 " + runId));
  assert.ok(page.indexOf("专题乙 " + runId) < page.indexOf("专题甲 " + runId));
  await client.json(topicPath, "PUT", { ...topic, id, version: 3, slug: topic.slug + "-changed" }, 422);
  await client.json(first.url + "/make-private", "POST", undefined, 200, { ...requestKey(), "If-Match": published.content.state.stateEtag });
  page = await (await fetch(path)).text();
  assert.ok(page.includes("专题乙 " + runId) && !page.includes("专题甲 " + runId));
  await client.json(topicPath, "PUT", { ...topic, id, version: 3, isPublic: false });
  assert.equal((await fetch(path)).status, 404);
  console.log("Passed: private creation, publication, ordering, slug lock, live privacy and withdrawal");
}
void run().catch(error => { console.error(error instanceof Error ? error.message : "V2 integration failed"); process.exitCode = 1; })
  .finally(async () => { await db().$disconnect(); });
