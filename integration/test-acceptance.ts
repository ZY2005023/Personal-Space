import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { Client as PgClient } from "pg";
import { AuthClient, base } from "./http-client";
import { db } from "../src/lib/db";
import { runMediaJob } from "../src/lib/media-worker";
import { verifyHash } from "../src/lib/auth-policy";
import { backupRuntime } from "../src/lib/backup-runtime";
import { runBackupJob } from "../src/lib/backup-worker";

const client = new AuthClient(), run = randomUUID().slice(0, 8);
let mediaAlbumId = "";
const results: { id: string; name: string; passed: boolean; error?: string }[] = [];
async function check(id: string, name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ id, name, passed: true }); console.log(`PASS ${id}: ${name}`); }
  catch (error) { results.push({ id, name, passed: false, error: error instanceof Error ? error.message : "unknown" }); console.error(`FAIL ${id}: ${name}: ${results.at(-1)!.error}`); }
}
const idempotency = () => ({ "Idempotency-Key": randomUUID() });
const payloadOf = (model: any, patch: any = {}) => { const { taxonomySnapshot: _snapshot, ...body } = model.draft.payload; return { ...body, ...patch }; };
async function load(id: string) { return (await client.json(`/api/v1/admin/contents/${id}`)).value.data; }
async function create(type: "ARTICLE" | "MOMENT" | "ALBUM", module: "LIFE" | "KNOWLEDGE") { return (await client.json("/api/v1/admin/contents", "POST", { type, module }, 201, idempotency())).value.data; }
async function save(model: any, patch: any = {}) { await client.json(`/api/v1/admin/contents/${model.state.id}/draft`, "PUT", payloadOf(model, { desiredVisibility: "PUBLIC", ...patch }), 200, { "If-Match": model.draft.etag }); return await load(model.state.id); }
async function publish(model: any, key = randomUUID()) { return (await client.json(`/api/v1/admin/contents/${model.state.id}/publish`, "POST", { expectedStateEtag: model.state.stateEtag }, 200, { "Idempotency-Key": key, "If-Match": model.draft.etag })).value.data; }
async function expectStatus(response: Response, status: number, code?: string) {
  const body = await response.clone().json().catch(() => null);
  assert.equal(response.status, status, `${response.url}: expected ${status}, got ${response.status}: ${JSON.stringify(body)}`);
  if (code) assert.equal(body?.code, code);
  return body;
}
async function upload(bytes: Buffer, type = "image/png") {
  const form = new FormData(); form.append("file", new File([new Uint8Array(bytes)], "acceptance.png", { type }));
  return (await client.json("/api/v1/admin/media", "POST", form, 202, idempotency())).value.data;
}

async function main() {
  if (process.env.PERSONAL_SPACE_INTEGRATION !== "true") throw new Error("Isolated integration environment required");
  await db().loginThrottle.updateMany({ data: { attempts: 0, windowStart: new Date(Date.now() - 16 * 60000) } });
  await client.login();

  await check("T-01", "anonymous administrator resources are denied without private data", async () => {
    const api = await fetch(base + "/api/v1/admin/contents");
    assert.equal(api.status, 401); assert.match(api.headers.get("cache-control") || "", /no-store/);
    const page = await fetch(base + "/admin", { redirect: "manual" });
    assert.ok([302, 307, 308].includes(page.status));
  });

  const originArticle = await create("ARTICLE", "KNOWLEDGE");
  await save(originArticle, { title: `origin ${run}`, bodyMarkdown: "body", desiredPath: `/knowledge/origin-${run}` });

  await check("T-03", "cross-site write is rejected without side effects and same-origin write succeeds", async () => {
    const before = await load(originArticle.state.id);
    const body = payloadOf(before, { title: `cross-site ${run}` });
    const denied = await client.raw(`/api/v1/admin/contents/${before.state.id}/draft`, { method: "PUT", headers: { "Content-Type": "application/json", "Origin": "https://evil.example", "If-Match": before.draft.etag }, body: JSON.stringify(body) });
    await expectStatus(denied, 403, "FORBIDDEN");
    const after = await load(before.state.id);
    assert.equal(after.draft.revisionNumber, before.draft.revisionNumber);
    const accepted = await client.raw(`/api/v1/admin/contents/${before.state.id}/draft`, { method: "PUT", headers: { "Content-Type": "application/json", "Origin": base, "If-Match": before.draft.etag }, body: JSON.stringify(body) });
    assert.equal(accepted.status, 200);
  });

  await check("T-09", "article, moment and album creation starts private and unpublished; module rules hold", async () => {
    for (const [type, module] of [["ARTICLE", "KNOWLEDGE"], ["MOMENT", "LIFE"], ["ALBUM", "LIFE"]] as const) {
      const model = await create(type, module);
      assert.equal(model.state.publicationState, "NEVER_PUBLISHED");
      assert.equal(model.state.effectiveVisibility, "PRIVATE");
      assert.equal(model.state.publishedRevisionId, null);
      assert.equal(model.draft.revisionNumber, 1);
      assert.equal(model.draft.payload.module, module);
    }
    const invalid = await client.raw("/api/v1/admin/contents", { method: "POST", headers: { "Content-Type": "application/json", ...idempotency() }, body: JSON.stringify({ type: "MOMENT", module: "KNOWLEDGE" }) });
    await expectStatus(invalid, 422, "INVALID_INPUT");
  });

  const numbering = await create("ARTICLE", "LIFE");
  const numberingSaved = await save(numbering, { title: `numbering ${run}`, bodyMarkdown: "first", desiredPath: `/life/numbering-${run}` });
  const firstPublish = await publish(numberingSaved);
  await check("T-13", "first and later publications use independent numbers and firstPublication", async () => {
    assert.equal(firstPublish.firstPublication, true);
    assert.equal(firstPublish.revision.publishedEditionNumber, 1);
    assert.equal(firstPublish.revision.versionNumber, 1);
    const current = await load(numbering.state.id);
    const saved = await save(current, { bodyMarkdown: "second" });
    const second = await publish(saved);
    assert.equal(second.firstPublication, false);
    assert.equal(second.revision.publishedEditionNumber, 2);
    assert.equal(second.revision.versionNumber, 2);
  });

  await check("T-12", "missing, weak and wildcard If-Match are rejected without writing", async () => {
    const model = await load(numbering.state.id);
    const body = payloadOf(model, { title: `weak ${run}` });
    for (const [headers, status] of [[{}, 428], [{ "If-Match": `W/${model.draft.etag}` }, 400], [{ "If-Match": "*" }, 400]] as const) {
      const response = await client.raw(`/api/v1/admin/contents/${model.state.id}/draft`, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
      await expectStatus(response, status);
    }
    assert.equal((await load(model.state.id)).draft.revisionNumber, model.draft.revisionNumber);
  });

  await check("T-19", "incomplete content saves but cannot publish; completing it then publishes", async () => {
    const model = await create("ARTICLE", "LIFE");
    const emptyPublish = await client.raw(`/api/v1/admin/contents/${model.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": model.draft.etag }, body: JSON.stringify({ expectedStateEtag: model.state.stateEtag }) });
    await expectStatus(emptyPublish, 422, "INVALID_INPUT");
    const titled = await save(model, { title: `titled ${run}`, desiredPath: `/life/titled-${run}` });
    const stillEmpty = await client.raw(`/api/v1/admin/contents/${model.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": titled.draft.etag }, body: JSON.stringify({ expectedStateEtag: titled.state.stateEtag }) });
    await expectStatus(stillEmpty, 422, "INVALID_INPUT");
    const completed = await save(titled, { bodyMarkdown: "now complete" });
    await publish(completed);
  });

  await check("T-08", "malicious Markdown is rendered without scripts, event handlers or javascript URLs", async () => {
    const model = await create("ARTICLE", "KNOWLEDGE");
    const dangerous = "<script>alert('x')</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\nallowed **text**";
    const saved = await save(model, { title: `markdown ${run}`, bodyMarkdown: dangerous, desiredPath: `/knowledge/markdown-${run}` });
    await publish(saved);
    const html = await (await fetch(base + `/knowledge/markdown-${run}`)).text();
    assert.doesNotMatch(html, /<script>alert/i);
    assert.doesNotMatch(html, /<img[^>]+onerror/i);
    assert.doesNotMatch(html, /href="javascript:/i);
    assert.match(html, /allowed/);
  });

  const permission = await create("ARTICLE", "KNOWLEDGE");
  const secretWord = `permission-${run}`;
  const permissionSaved = await save(permission, { title: `permission ${run}`, bodyMarkdown: `只有公开版本才可搜索 ${secretWord}`, desiredPath: `/knowledge/permission-${run}` });
  await publish(permissionSaved);

  await check("T-06", "private, trashed and absent content never leaks through detail, search or old paths", async () => {
    assert.equal((await fetch(base + `/api/v1/contents/${permission.state.id}`)).status, 200);
    const search = await (await fetch(base + "/api/v1/search?q=" + encodeURIComponent(secretWord))).json();
    assert.ok(search.data.some((row: any) => row.id === permission.state.id));
    const current = await load(permission.state.id);
    await client.json(`/api/v1/admin/contents/${permission.state.id}/make-private`, "POST", undefined, 200, { ...idempotency(), "If-Match": current.state.stateEtag });
    assert.equal((await fetch(base + `/api/v1/contents/${permission.state.id}`)).status, 404);
    assert.equal((await fetch(base + `/knowledge/permission-${run}`)).status, 404);
    assert.equal((await fetch(base + "/api/v1/routes/resolve?path=" + encodeURIComponent(`/knowledge/permission-${run}`))).status, 404);
    const afterPrivate = await (await fetch(base + "/api/v1/search?q=" + encodeURIComponent(secretWord))).json();
    assert.ok(!afterPrivate.data.some((row: any) => row.id === permission.state.id));
    assert.equal((await fetch(base + `/api/v1/contents/${randomUUID()}`)).status, 404);
    const privateModel = await load(permission.state.id);
    await client.json(`/api/v1/admin/contents/${permission.state.id}/trash`, "POST", undefined, 200, { ...idempotency(), "If-Match": privateModel.state.stateEtag });
    assert.equal((await fetch(base + `/api/v1/contents/${permission.state.id}`)).status, 404);
  });

  await check("T-14", "stale live-state ETag blocks a publish and cannot republish accidentally", async () => {
    const model = await create("ARTICLE", "LIFE");
    const saved = await save(model, { title: `state ${run}`, bodyMarkdown: "state", desiredPath: `/life/state-${run}` });
    const published = await publish(saved);
    const stateBefore = published.content.state;
    const current = await load(model.state.id);
    await client.json(`/api/v1/admin/contents/${model.state.id}/make-private`, "POST", undefined, 200, { ...idempotency(), "If-Match": current.state.stateEtag });
    const draft = await load(model.state.id);
    const stale = await client.raw(`/api/v1/admin/contents/${model.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": draft.draft.etag }, body: JSON.stringify({ expectedStateEtag: stateBefore.stateEtag }) });
    await expectStatus(stale, 412, "STATE_CONFLICT");
    assert.equal((await load(model.state.id)).state.effectiveVisibility, "PRIVATE");
  });

  await check("T-16", "failure at each publish step rolls back the whole publication", async () => {
    const model = await create("ARTICLE", "LIFE");
    const saved = await save(model, { title: `rollback ${run}`, bodyMarkdown: "rollback", desiredPath: `/life/rollback-${run}` });
    const owner = new PgClient({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    try {
      for (const table of ["content_revisions", "content_publications", "content_routes", "content_search_documents", "outbox_events", "contents"]) {
        const name = `inject_${run}_${table}`;
        await owner.query(`CREATE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
        await owner.query(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}_fn()`);
        try {
          const response = await client.raw(`/api/v1/admin/contents/${model.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": saved.draft.etag }, body: JSON.stringify({ expectedStateEtag: saved.state.stateEtag }) });
          await expectStatus(response, 503, "SERVICE_UNAVAILABLE");
          const [row] = await db().$queryRaw<{ state: string; pointer: string | null; revisions: number; routes: number; search: number; events: number }[]>`
            SELECT c.publication_state AS state, c.published_revision_id::text AS pointer,
              (SELECT count(*)::int FROM content_revisions r WHERE r.content_id = c.id) AS revisions,
              (SELECT count(*)::int FROM content_routes r WHERE r.content_id = c.id) AS routes,
              (SELECT count(*)::int FROM content_search_documents d WHERE d.content_id = c.id) AS search,
              (SELECT count(*)::int FROM outbox_events e WHERE e.aggregate_id = c.id) AS events
            FROM contents c WHERE c.id = ${model.state.id}::uuid`;
          if (!row) throw new Error("content disappeared after injected failure");
          assert.equal(row.state, "NEVER_PUBLISHED", table);
          assert.equal(row.pointer, null, table);
          assert.equal(row.revisions, 0, table);
          assert.equal(row.routes, 0, table);
          assert.equal(row.search, 0, table);
          assert.equal(row.events, 1, `${table}: creation event only`);
        } finally {
          await owner.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
          await owner.query(`DROP FUNCTION IF EXISTS ${name}_fn()`);
        }
      }
      const rollbackPng = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#224433" } }).png().toBuffer();
      const rollbackMedia = await upload(rollbackPng);
      await runMediaJob();
      const album = await create("ALBUM", "LIFE");
      const albumSaved = await save(album, { title: `rollback-media ${run}`, desiredPath: `/life/rollback-media-${run}`, placements: [{ placementId: randomUUID(), mediaId: rollbackMedia.media.id, role: "ALBUM_PHOTO", caption: "", altText: "media" }] });
      const mediaTrigger = `inject_${run}_content_media`;
      await owner.query(`CREATE FUNCTION ${mediaTrigger}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
      await owner.query(`CREATE TRIGGER ${mediaTrigger} BEFORE INSERT OR UPDATE ON content_media FOR EACH ROW EXECUTE FUNCTION ${mediaTrigger}_fn()`);
      try {
        const response = await client.raw(`/api/v1/admin/contents/${album.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": albumSaved.draft.etag }, body: JSON.stringify({ expectedStateEtag: albumSaved.state.stateEtag }) });
        await expectStatus(response, 503, "SERVICE_UNAVAILABLE");
        const [mediaRow] = await db().$queryRaw<{ state: string; revisions: number; media: number }[]>`
          SELECT c.publication_state AS state,
            (SELECT count(*)::int FROM content_revisions r WHERE r.content_id = c.id) AS revisions,
            (SELECT count(*)::int FROM content_media m WHERE m.content_id = c.id) AS media
          FROM contents c WHERE c.id = ${album.state.id}::uuid`;
        assert.equal(mediaRow?.state, "NEVER_PUBLISHED");
        assert.equal(mediaRow?.revisions, 0);
        assert.equal(mediaRow?.media, 0);
      } finally {
        await owner.query(`DROP TRIGGER IF EXISTS ${mediaTrigger} ON content_media`);
        await owner.query(`DROP FUNCTION IF EXISTS ${mediaTrigger}_fn()`);
      }
      const current = await load(model.state.id);
      await publish(current);
      console.log("  publish succeeds after all injected failures are removed");
    } finally { await owner.end(); }
  });

  await check("T-17/T-18", "idempotent publish replays one result and rejects the same key with different parameters", async () => {
    const model = await create("ARTICLE", "KNOWLEDGE");
    const saved = await save(model, { title: `idempotent ${run}`, bodyMarkdown: "once", desiredPath: `/knowledge/idempotent-${run}` });
    const key = randomUUID();
    const first = await publish(saved, key);
    const replay = await client.json(`/api/v1/admin/contents/${model.state.id}/publish`, "POST", { expectedStateEtag: saved.state.stateEtag }, 200, { "Idempotency-Key": key, "If-Match": saved.draft.etag });
    assert.equal(replay.value.data.revision.id, first.revision.id);
    const revisions = await client.json(`/api/v1/admin/contents/${model.state.id}/revisions?limit=100`);
    assert.equal(revisions.value.data.length, 1);
    const mismatch = await client.raw(`/api/v1/admin/contents/${model.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key, "If-Match": saved.draft.etag }, body: JSON.stringify({ expectedStateEtag: `"different-${run}"` }) });
    await expectStatus(mismatch, 409, "IDEMPOTENCY_MISMATCH");
  });

  await check("T-22/T-23", "recycle-bin recovery is private; a never-published draft keeps no pointer", async () => {
    const never = await create("MOMENT", "LIFE");
    const neverSaved = await save(never, { title: `never ${run}`, bodyMarkdown: "never", desiredPath: `/life/never-${run}` });
    await client.json(`/api/v1/admin/contents/${never.state.id}/trash`, "POST", undefined, 200, { ...idempotency(), "If-Match": neverSaved.state.stateEtag });
    const neverTrashed = await load(never.state.id);
    await client.json(`/api/v1/admin/contents/${never.state.id}/restore`, "POST", undefined, 200, { ...idempotency(), "If-Match": neverTrashed.state.stateEtag });
    const neverRestored = await load(never.state.id);
    assert.equal(neverRestored.state.publicationState, "NEVER_PUBLISHED");
    assert.equal(neverRestored.state.publishedRevisionId, null);
    assert.equal(neverRestored.draft.payload.desiredVisibility, "PRIVATE");

    const publishedModel = await create("ARTICLE", "LIFE");
    const saved = await save(publishedModel, { title: `trash ${run}`, bodyMarkdown: "trash", desiredPath: `/life/trash-${run}` });
    const published = await publish(saved);
    await client.json(`/api/v1/admin/contents/${publishedModel.state.id}/trash`, "POST", undefined, 200, { ...idempotency(), "If-Match": published.content.state.stateEtag });
    const trashed = await load(publishedModel.state.id);
    await client.json(`/api/v1/admin/contents/${publishedModel.state.id}/restore`, "POST", undefined, 200, { ...idempotency(), "If-Match": trashed.state.stateEtag });
    const restored = await load(publishedModel.state.id);
    assert.equal(restored.state.publicationState, "UNPUBLISHED");
    assert.equal(restored.state.effectiveVisibility, "PRIVATE");
    assert.equal(restored.state.publishedRevisionId, published.revision.id);
    assert.equal(restored.draft.payload.desiredVisibility, "PRIVATE");
  });

  await check("T-25", "concurrent category creation conflicts and third levels are rejected", async () => {
    const name = `并发分类 ${run}`, slug = `concurrent-${run}`;
    const body = JSON.stringify({ name, slug, module: "KNOWLEDGE", parentId: null, sortOrder: 0 });
    const [a, b] = await Promise.all([
      client.raw("/api/v1/admin/categories", { method: "POST", headers: { "Content-Type": "application/json", ...idempotency() }, body }),
      client.raw("/api/v1/admin/categories", { method: "POST", headers: { "Content-Type": "application/json", ...idempotency() }, body }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const ok = a.status === 201 ? a : b;
    const root = (await ok.json()).data;
    const child = (await client.json("/api/v1/admin/categories", "POST", { name: `子分类 ${run}`, slug: `child-${run}`, module: "KNOWLEDGE", parentId: root.id, sortOrder: 0 }, 201, idempotency())).value.data;
    const third = await client.raw("/api/v1/admin/categories", { method: "POST", headers: { "Content-Type": "application/json", ...idempotency() }, body: JSON.stringify({ name: `三级 ${run}`, slug: `third-${run}`, module: "KNOWLEDGE", parentId: child.id, sortOrder: 0 }) });
    await expectStatus(third, 422, "INVALID_INPUT");
  });

  await check("T-26", "category deletion and a concurrent new reference never leave a dangling link", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const category = (await client.json("/api/v1/admin/categories", "POST", { name: `并发引用 ${run}-${attempt}`, slug: `race-ref-${run}-${attempt}`, module: "KNOWLEDGE", parentId: null, sortOrder: 0 }, 201, idempotency())).value.data;
      const etag = (await client.json(`/api/v1/admin/categories/${category.id}`)).etag; assert.ok(etag);
      const model = await create("ARTICLE", "KNOWLEDGE");
      const saved = await save(model, { title: `race ${run}-${attempt}`, bodyMarkdown: "race", desiredPath: `/knowledge/race-${run}-${attempt}` });
      const body = JSON.stringify(payloadOf(saved, { categoryId: category.id }));
      const [deletion, write] = await Promise.all([
        client.raw(`/api/v1/admin/categories/${category.id}`, { method: "DELETE", headers: { ...idempotency(), "If-Match": etag } }),
        client.raw(`/api/v1/admin/contents/${model.state.id}/draft`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": saved.draft.etag }, body }),
      ]);
      const pair = [deletion.status, write.status].sort();
      assert.ok(pair[0] === 204 && pair[1] === 422 || pair[0] === 200 && pair[1] === 409, `unexpected race outcome ${pair}`);
      const [row] = await db().$queryRaw<{ deleted_at: Date | null; references: number }[]>`
        SELECT c.deleted_at,
          (SELECT count(*)::int FROM draft_categories d WHERE d.content_id = ${model.state.id}::uuid AND d.category_id = ${category.id}::uuid) AS references
        FROM categories c WHERE c.id = ${category.id}::uuid`;
      if (deletion.status === 204) { assert.ok(row?.deleted_at); assert.equal(row?.references, 0); }
      else { assert.equal(row?.deleted_at, null); assert.equal(row?.references, 1); }
    }
  });

  await check("T-28", "path conflicts are refused, old addresses redirect once and remain reserved", async () => {
    const a = await create("ARTICLE", "KNOWLEDGE"), pathA = `/knowledge/conflict-a-${run}`;
    const aSaved = await save(a, { title: `conflict A ${run}`, bodyMarkdown: "a", desiredPath: pathA });
    await publish(aSaved);
    const b = await create("ARTICLE", "KNOWLEDGE");
    const bSaved = await save(b, { title: `conflict B ${run}`, bodyMarkdown: "b", desiredPath: pathA });
    const conflict = await client.raw(`/api/v1/admin/contents/${b.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": bSaved.draft.etag }, body: JSON.stringify({ expectedStateEtag: bSaved.state.stateEtag }) });
    await expectStatus(conflict, 409, "PATH_CONFLICT");
    const aCurrent = await load(a.state.id);
    const newPath = `/knowledge/conflict-a-moved-${run}`;
    const aMoved = await save(aCurrent, { desiredPath: newPath });
    await publish(aMoved);
    const alias = await fetch(base + "/api/v1/routes/resolve?path=" + encodeURIComponent(pathA), { redirect: "manual" });
    assert.equal(alias.status, 308); assert.equal(alias.headers.get("location"), newPath);
    const bCurrent = await load(b.state.id);
    const reserved = await client.raw(`/api/v1/admin/contents/${b.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": bCurrent.draft.etag }, body: JSON.stringify({ expectedStateEtag: bCurrent.state.stateEtag }) });
    await expectStatus(reserved, 409, "PATH_CONFLICT");
  });

  await check("T-29", "invalid path forms are rejected before writing", async () => {
    const model = await create("ARTICLE", "LIFE");
    for (const path of [`/life/Bad_Path-${run}`, `/settings/path-${run}`, `/life/path-${run}/`, `/life/../path-${run}`, `/life/${"a".repeat(600)}`]) {
      const response = await client.raw(`/api/v1/admin/contents/${model.state.id}/draft`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": model.draft.etag }, body: JSON.stringify(payloadOf(model, { title: "path", desiredPath: path })) });
      await expectStatus(response, 422);
    }
    assert.equal((await load(model.state.id)).draft.revisionNumber, 1);
  });

  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#335544" } }).png().toBuffer();
  const uploaded = await upload(png);
  await check("T-32", "publication refuses pending media and succeeds after the worker marks it READY", async () => {
    const model = await create("ALBUM", "LIFE"); mediaAlbumId = model.state.id;
    const placementId = randomUUID();
    const saved = await save(model, { title: `media ${run}`, desiredPath: `/life/media-${run}`, coverMediaId: null, placements: [{ placementId, mediaId: uploaded.media.id, role: "ALBUM_PHOTO", caption: "", altText: "media" }] });
    const notReady = await client.raw(`/api/v1/admin/contents/${model.state.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json", ...idempotency(), "If-Match": saved.draft.etag }, body: JSON.stringify({ expectedStateEtag: saved.state.stateEtag }) });
    await expectStatus(notReady, 422, "MEDIA_NOT_READY");
    await runMediaJob();
    const current = await load(model.state.id);
    await publish(current);
    const publicItem = await (await fetch(base + `/api/v1/contents/${model.state.id}`)).json();
    assert.equal(publicItem.data.payload.placements[0].placementId, placementId);
  });

  await check("T-20/T-33", "revoking visibility immediately blocks the derivative; referenced media cannot be deleted", async () => {
    const album = await load(mediaAlbumId);
    const placement = album.draft.payload.placements[0];
    assert.equal((await fetch(base + `/api/v1/contents/${album.state.id}/placements/${placement.placementId}/image?variant=DISPLAY`)).status, 200);
    await client.json(`/api/v1/admin/contents/${album.state.id}/make-private`, "POST", undefined, 200, { ...idempotency(), "If-Match": album.state.stateEtag });
    assert.equal((await fetch(base + `/api/v1/contents/${album.state.id}/placements/${placement.placementId}/image?variant=DISPLAY`)).status, 404);
    const deletion = await client.raw(`/api/v1/admin/media/${uploaded.media.id}`, { method: "DELETE", headers: idempotency() });
    await expectStatus(deletion, 409, "RESOURCE_REFERENCED");
  });

  await check("T-34", "oversized and MIME-spoofed uploads are refused", async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const form = new FormData(); form.append("file", new File([new Uint8Array(oversized)], "large.png", { type: "image/png" }));
    await expectStatus(await client.raw("/api/v1/admin/media", { method: "POST", headers: idempotency(), body: form }), 413);
    const forgedForm = new FormData(); forgedForm.append("file", new File([new Uint8Array(png)], "forged.jpg", { type: "image/jpeg" }));
    await expectStatus(await client.raw("/api/v1/admin/media", { method: "POST", headers: idempotency(), body: forgedForm }), 415);
  });

  await check("T-05", "export and backup require a fresh reauthentication proof", async () => {
    const exportResponse = await client.raw("/api/v1/admin/exports", { method: "POST", headers: { "Content-Type": "application/json", ...idempotency() }, body: JSON.stringify({ includeMedia: false }) });
    await expectStatus(exportResponse, 403, "REAUTH_REQUIRED");
    const backupResponse = await client.raw("/api/v1/admin/backups", { method: "POST", headers: idempotency() });
    await expectStatus(backupResponse, 403, "REAUTH_REQUIRED");
  });

  await check("T-39", "local backup success and integrity remain visible when the offsite stage fails", async () => {
    const backupId = randomUUID();
    const job = await db().operationJob.create({ data: { jobType: "BACKUP", payload: { adminId: client.adminId, backupId, backupType: "MANUAL" } } });
    await db().backupRun.create({ data: { id: backupId, jobId: job.id, backupType: "MANUAL" } });
    const runtime = backupRuntime();
    const failingOffsite = { ...runtime.tools, offsite: async () => { throw new Error("injected offsite failure"); } };
    for (let attempt = 0; attempt < 3; attempt++) await runBackupJob(runtime.config, failingOffsite);
    const record = (await client.json(`/api/v1/admin/backups/${backupId}`)).value.data;
    assert.equal(record.localStatus, "SUCCEEDED");
    assert.equal(record.integrityStatus, "SUCCEEDED");
    assert.equal(record.offsiteStatus, "FAILED");
    assert.equal(record.status, "FAILED");
    const html = await (await client.raw("/admin/backups?limit=100")).text();
    assert.match(html, /本地副本/); assert.match(html, /异地副本/); assert.match(html, /失败/);
  });

  await check("T-10", "saving a draft never changes the current public title, path or media order", async () => {
    const album = await load(mediaAlbumId);
    // The album is private after T-20; republish it first so the public projection exists.
    const before = await publish(album);
    const publicBefore = await (await fetch(base + `/api/v1/contents/${album.state.id}`)).json();
    const current = await load(album.state.id);
    const reordered = [...current.draft.payload.placements].reverse();
    await save(current, { title: `changed ${run}`, bodyMarkdown: "changed", desiredPath: `/life/changed-${run}`, placements: reordered });
    const publicAfter = await (await fetch(base + `/api/v1/contents/${album.state.id}`)).json();
    assert.equal(publicAfter.data.payload.title, publicBefore.data.payload.title);
    assert.equal(publicAfter.data.payload.desiredPath ?? publicAfter.data.canonicalPath, publicBefore.data.canonicalPath);
    assert.deepEqual(publicAfter.data.payload.placements.map((p: any) => p.placementId), publicBefore.data.payload.placements.map((p: any) => p.placementId));
  });

  await check("T-04", "two concurrent recovery-code logins consume the code exactly once", async () => {
    const secrets = JSON.parse(await readFile("work/integration/secrets.json", "utf8"));
    const unused = await db().recoveryCode.findMany({ where: { adminId: client.adminId, usedAt: null } });
    let code: string | undefined;
    for (const candidate of secrets.testRecoveryCodes as string[]) for (const row of unused) if (!code && await verifyHash(row.codeHash, candidate.toLowerCase())) code = candidate;
    assert.ok(code, "no unused recovery code available");
    const one = new AuthClient(), two = new AuthClient();
    const outcomes = await Promise.allSettled([one.login(code), two.login(code)]);
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  });

  const failed = results.filter(result => !result.passed);
  await mkdir("work/integration/evidence", { recursive: true });
  await writeFile("work/integration/evidence/acceptance.json", JSON.stringify({ passed: failed.length === 0, results, completedAt: new Date().toISOString() }, null, 2));
  if (failed.length) { console.error(`${failed.length} acceptance check(s) failed`); process.exitCode = 1; }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "acceptance test failed"); process.exitCode = 1; }).finally(async () => { await db().$disconnect(); });