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
for (const kind of ["categories", "tags"]) {
  const response = await get(`/api/v1/${kind}?limit=1`);
  const page = await response.json(); assert.ok(Array.isArray(page.data)); assert.ok(page.data.length <= 1); assert.equal(page.meta.hasMore, false); assert.equal(page.meta.nextCursor, null);
  await get(`/api/v1/${kind}?cursor=tampered`, 400);
}
for (const path of ["/life", "/knowledge", "/albums", "/search"]) {
  const html = await (await get(path)).text(); assert.match(html, /筛选公开内容/); assert.match(html, /name="categoryId"/); assert.match(html, /name="tagId"/);
}
const filtered = await (await get("/life?type=MOMENT")).text(); assert.match(filtered, /在日常里留一点空白/); assert.doesNotMatch(filtered, /class="content-title"[^>]*>山里的清晨/);
const scopedSearch = await (await get("/search?q=" + encodeURIComponent("笔记") + "&module=KNOWLEDGE&type=ARTICLE")).text(); assert.match(scopedSearch, /如何建立可回访的笔记/);
for (const path of ["/life?cursor=tampered", "/albums?cursor=tampered", "/search?q=note&cursor=tampered"]) assert.match(await (await get(path)).text(), /返回筛选结果第一页/);
for (const path of ["/knowledge?type=MOMENT", "/life?categoryId=bad", "/search?q=one&q=two"]) assert.match(await (await get(path)).text(), /筛选条件无法识别/);
await get("/api/v1/admin/audit-logs", 401); await get("/admin/audit", 307);
await get("/api/v1/admin/settings", 401);
const deniedSettings = await fetch(base + "/api/v1/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteTitle: "anonymous", siteIntro: "" }) });
assert.equal(deniedSettings.status, 401); checks.push({ path: "PUT /api/v1/admin/settings (anonymous)", status: deniedSettings.status });
const readingInfo = await (await get("/knowledge/notes")).text(); assert.match(readingInfo, /如何建立可回访的笔记.*Personal Space/); assert.match(readingInfo, /name="description"/);
const albumInfo = await (await get("/life/morning-mountains")).text(); assert.match(albumInfo, /山里的清晨.*Personal Space/);
await get("/api/v1/admin/backups", 401); await get("/api/v1/admin/backups/10000000-0000-4000-8000-000000000001", 401); await get("/api/v1/admin/restore-drills", 401); await get("/admin/backups", 307); await get("/admin/backups/10000000-0000-4000-8000-000000000001", 307);
for (const path of ["exports", "backups"]) {
  const response = await fetch(base + `/api/v1/admin/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ includeMedia: true }) }); assert.equal(response.status, 401); checks.push({ path: `POST /api/v1/admin/${path} (anonymous)`, status: response.status });
}
await get("/api/v1/admin/exports/10000000-0000-4000-8000-000000000001/download", 401);
const admin = await get("/api/v1/admin/contents", 401); assert.match(admin.headers.get("content-type"), /application\/problem\+json/); assert.match(admin.headers.get("cache-control"), /no-store/);
await get("/api/v1/admin/media/10000000-0000-4000-8000-000000000001/original", 401);
await get("/api/v1/admin/media", 401); await get("/api/v1/admin/media/10000000-0000-4000-8000-000000000001/image?variant=DISPLAY", 401);
await get("/api/v1/admin/jobs/10000000-0000-4000-8000-000000000001", 401); await get("/admin/media", 307);
await get("/api/v1/contents/10000000-0000-4000-8000-000000000001/placements/20000000-0000-4000-8000-000000000001/image?variant=ORIGINAL", 400);
for (const method of ["POST", "DELETE"]) {
  const path = "/api/v1/admin/media" + (method === "POST" ? "" : "/10000000-0000-4000-8000-000000000001");
  const response = await fetch(base + path, { method }); assert.equal(response.status, 401); checks.push({ path: method + " " + path + " (anonymous)", status: response.status });
}
await get("/api/v1/admin/categories", 401); await get("/api/v1/admin/tags", 401); await get("/admin/taxonomy", 307);
for (const method of ["POST", "PUT", "DELETE"]) {
  const path = "/api/v1/admin/tags" + (method === "POST" ? "" : "/10000000-0000-4000-8000-000000000001");
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(method === "DELETE" ? {} : { body: JSON.stringify({ name: "unauthorized", slug: "unauthorized" }) }) });
  assert.equal(response.status, 401); checks.push({ path: method + " " + path + " (anonymous)", status: response.status });
}
const denied = await fetch(base + "/api/v1/admin/contents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ARTICLE", module: "KNOWLEDGE" }) }); assert.equal(denied.status, 401); checks.push({ path: "POST /api/v1/admin/contents (anonymous)", status: denied.status });
await get("/admin/security", 307); await get("/admin/security?recovery=1", 307);
for (const action of ["reauthenticate", "password", "recovery-codes", "revoke-sessions", "mfa-start", "mfa-confirm", "mfa-cancel", "recovery-mfa-start"]) {
  const response = await fetch(base + "/api/auth/security/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 401); assert.match(response.headers.get("cache-control"), /no-store/); checks.push({ path: "POST /api/auth/security/" + action + " (anonymous)", status: 401 });
}
await get("/admin/contents?q=notes&type=ARTICLE", 307); await get("/admin/trash?cursor=tampered", 307);
await get("/api/v1/admin/contents?limit=2&q=notes", 401);
await get("/api/v1/admin/contents/10000000-0000-4000-8000-000000000001/revisions?limit=2", 401);
await get("/api/v1/admin/contents/10000000-0000-4000-8000-000000000001/state", 401);
for (const [method, suffix] of [["PUT", "/draft"], ["POST", "/publish"], ["POST", "/revisions"], ["POST", "/revisions/20000000-0000-4000-8000-000000000001/restore"]]) {
  const path = "/api/v1/admin/contents/10000000-0000-4000-8000-000000000001" + suffix;
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: "{}" }); assert.equal(response.status, 401); checks.push({ path: method + " " + path + " (anonymous)", status: 401 });
}
await get("/admin", 307);
console.log(JSON.stringify({ mode: "local-read-only-preview", checks, count: checks.length, databaseMutations: 0 }, null, 2));
