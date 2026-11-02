import assert from "node:assert/strict";
const base = process.env.SMOKE_URL || "http://127.0.0.1:3000";
const checks = [];
async function get(path, status = 200) {
  const r = await fetch(base + path, { redirect: "manual" }); assert.equal(r.status, status, path); checks.push({ path, status }); return r;
}
const home = await get("/"); assert.match(await home.text(), /记录生活/);
await get("/life"); await get("/knowledge"); await get("/albums"); await get("/login");
const list = await get("/api/v1/contents?limit=1"), first = await list.json(); assert.equal(first.data.length, 1); assert.equal(first.meta.hasMore, true); assert.ok(first.meta.nextCursor);
const second = await (await get("/api/v1/contents?limit=1&cursor=" + encodeURIComponent(first.meta.nextCursor))).json(); assert.notEqual(first.data[0].id, second.data[0].id);
const search = await (await get("/api/v1/search?q=" + encodeURIComponent("笔记"))).json(); assert.ok(search.data.some(i => i.title.includes("笔记")));
await get("/api/v1/search?q=%20", 400); await get("/api/v1/contents?limit=1000", 400); await get("/api/v1/contents?cursor=tampered", 400);
await get("/api/v1/contents/00000000-0000-4000-8000-000000000000", 404);
const admin = await get("/api/v1/admin/contents", 401); assert.match(admin.headers.get("content-type"), /application\/problem\+json/); assert.match(admin.headers.get("cache-control"), /no-store/);
await get("/api/v1/admin/media/10000000-0000-4000-8000-000000000001/original", 401);
const denied = await fetch(base + "/api/v1/admin/contents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ARTICLE", module: "KNOWLEDGE" }) }); assert.equal(denied.status, 401); checks.push({ path: "POST /api/v1/admin/contents (anonymous)", status: denied.status });
await get("/admin", 307);
console.log(JSON.stringify({ mode: "local-read-only-preview", checks, count: checks.length, databaseMutations: 0 }, null, 2));
