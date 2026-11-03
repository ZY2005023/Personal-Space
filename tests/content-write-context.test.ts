import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWriteContext, mutate } from "../src/lib/content-store";
import { changeState, createContent, DomainError, draftEtag, publish, restoreRevision, saveDraft, snapshot, stateEtag, viewAdmin, type Aggregate } from "../src/lib/domain";
import { adminId, publishedId, manualId, contentWriteFixture } from "./helpers/content-write-fixture";
const metadataReads = (h: ReturnType<typeof contentWriteFixture>) => h.reads.filter(r => r.table === "contentRevision");
test("saving and changing visibility load no snapshots, version metadata or historical routes", async () => {
  for (const intent of ["save", "state"] as const) {
    const h = contentWriteFixture(), context = await loadWriteContext(h.tx, h.id, adminId, intent);
    assert.equal(context.revisions.length, 0); assert.equal(context.revisionHead, undefined); assert.equal(context.aliases.length, 0); assert.equal(metadataReads(h).length, 0); assert.equal(h.reads.some(r => r.table === "contentRoute"), false);
    assert.deepEqual(h.reads[0].args.include, { draft: true });
  }
});
test("version-creating intents read two independent numeric heads without snapshot bodies", async () => {
  const h = contentWriteFixture(), context = await loadWriteContext(h.tx, h.id, adminId, "publish");
  assert.deepEqual(context.revisionHead, { versionNumber: 1000000, publishedEditionNumber: 600 }); assert.equal(context.revisions.length, 0); assert.equal(h.control.snapshotReads, 0);
  assert.deepEqual(metadataReads(h).map(r => r.args.select), [{ versionNumber: true }, { publishedEditionNumber: true }]);
  const routes = h.reads.find(r => r.table === "contentRoute")!; assert.equal(routes.args.take, 2); assert.equal((routes.args.where as { routeKind: string }).routeKind, "CANONICAL"); assert.deepEqual(context.aliases, []);
  const s = contentWriteFixture(); await loadWriteContext(s.tx, s.id, adminId, "snapshot"); assert.equal(metadataReads(s).length, 2); assert.equal(s.control.snapshotReads, 0);
});
test("compact domain contexts preserve independent history and publication numbering", () => {
  const a = createContent("ARTICLE", "KNOWLEDGE"); a.draft.payload.title = "title"; a.draft.payload.bodyMarkdown = "body"; a.revisionHead = { versionNumber: 1000000, publishedEditionNumber: 600 };
  const manual = snapshot(a, draftEtag(a.draft)); assert.equal(manual.revisions[0].versionNumber, 1000001); assert.equal(manual.revisions[0].publishedEditionNumber, null);
  const live = publish(manual, draftEtag(manual.draft), stateEtag(manual.state)); assert.equal(live.revisions.at(-1)!.versionNumber, 1000002); assert.equal(live.revisions.at(-1)!.publishedEditionNumber, 601);
  assert.equal("revisionHead" in viewAdmin(live), false);
});
test("domain numbering refuses invalid or overflowing persisted heads", () => {
  const a = createContent("ARTICLE", "KNOWLEDGE"); a.revisionHead = { versionNumber: -1, publishedEditionNumber: 0 };
  assert.throws(() => snapshot(a, draftEtag(a.draft)), e => e instanceof DomainError && e.status === 500);
  a.revisionHead.versionNumber = 2147483647; assert.throws(() => snapshot(a, draftEtag(a.draft)), e => e instanceof DomainError && e.status === 409);
});
test("restore loads only its requested owned revision and never computes new counters", async () => {
  const h = contentWriteFixture(), context = await loadWriteContext(h.tx, h.id, adminId, "restore-revision", manualId);
  assert.equal(context.revisions.length, 1); assert.equal(context.revisions[0].id, manualId); assert.equal(h.control.snapshotReads, 1); assert.equal(metadataReads(h).length, 1);
  assert.deepEqual(metadataReads(h)[0].args.where, { id: manualId, contentId: h.id }); assert.equal(context.revisionHead, undefined);
  await assert.rejects(loadWriteContext(h.tx, h.id, "wrong-owner", "save"), e => e instanceof DomainError && e.status === 404);
  await assert.rejects(loadWriteContext(h.tx, h.id, adminId, "restore-revision", "foreign-revision"), e => e instanceof DomainError && e.status === 404);
});
test("save preserves publication and all history without reading snapshot bodies", async () => {
  const h = contentWriteFixture(), original = structuredClone(h.tables.contentRevision);
  const model = await mutate({ adminId, scope: h.id + ":save", intent: "save", contentId: h.id, fingerprint: { save: true }, change: a => saveDraft(a!, { ...a!.draft.payload, title: "only draft" }, draftEtag(a!.draft)) }, h.client) as ReturnType<typeof viewAdmin>;
  assert.equal(model.draft.payload.title, "only draft"); assert.equal(model.state.publishedRevisionId, publishedId); assert.equal(model.state.stateVersion, 7); assert.equal(model.draft.revisionNumber, 43);
  assert.deepEqual(h.tables.contentRevision, original); assert.equal(h.control.snapshotReads, 0); assert.equal(metadataReads(h).length, 0); assert.equal(h.tables.contentPublication[0].title, "正式版本");
});
function publishOptions(h: ReturnType<typeof contentWriteFixture>, key = "publish-key-000001") {
  return { adminId, scope: h.id + ":publish", intent: "publish" as const, contentId: h.id, key, fingerprint: { draftMatch: "original", stateMatch: "original" }, change: (a: Aggregate | null) => publish(a!, draftEtag(a!.draft), stateEtag(a!.state)), result: (a: Aggregate) => ({ content: viewAdmin(a), revision: a.revisions.at(-1) }) };
}
test("publication appends only one snapshot and touches at most old/new canonical routes, retaining 200 aliases", async () => {
  const h = contentWriteFixture(); (h.tables.contentDraft[0].draftPayload as { desiredPath: string }).desiredPath = "/knowledge/new-path";
  const result = await mutate(publishOptions(h), h.client) as { revision: { versionNumber: number; publishedEditionNumber: number }; content: ReturnType<typeof viewAdmin> };
  assert.equal(result.revision.versionNumber, 1000001); assert.equal(result.revision.publishedEditionNumber, 601); assert.equal(h.tables.contentRevision.length, 3); assert.equal(h.control.snapshotReads, 0);
  const paths = h.writes.filter(w => w.table === "contentRoute" && w.method === "upsert").map(w => (w.data as { path: string }).path);
  assert.deepEqual(paths, ["/knowledge/current", "/knowledge/new-path"]); assert.equal(h.tables.contentRoute.filter(r => r.routeKind === "ALIAS").length, 201); assert.equal(h.tables.contentPublication[0].revisionId, result.content.state.publishedRevisionId);
  const reads = h.reads.length, history = h.tables.contentRevision.length; const replay = await mutate(publishOptions(h), h.client); assert.deepEqual(replay, result); assert.equal(h.tables.contentRevision.length, history); assert.equal(h.reads.length, reads + 1);
});
test("switching an existing own alias back to canonical preserves other aliases", async () => {
  const h = contentWriteFixture(); (h.tables.contentDraft[0].draftPayload as { desiredPath: string }).desiredPath = "/knowledge/old-50";
  await mutate(publishOptions(h), h.client);
  assert.equal(h.tables.contentRoute.find(r => r.path === "/knowledge/old-50")!.routeKind, "CANONICAL"); assert.equal(h.tables.contentRoute.filter(r => r.routeKind === "ALIAS").length, 200);
  assert.equal(h.tables.contentRoute.find(r => r.path === "/knowledge/current")!.routeKind, "ALIAS");
});
test("path conflict and failed audit roll back snapshots, pointers, projections and idempotency", async () => {
  for (const failure of ["path", "audit"]) {
    const h = contentWriteFixture();
    if (failure === "path") { h.tables.contentRoute.push({ path: "/knowledge/occupied", contentId: "other-content", routeKind: "CANONICAL" }); (h.tables.contentDraft[0].draftPayload as { desiredPath: string }).desiredPath = "/knowledge/occupied"; } else h.control.failAudit = true;
    const before = structuredClone(h.tables); await assert.rejects(mutate(publishOptions(h), h.client)); assert.deepEqual(h.tables, before);
  }
});
test("restoring a targeted snapshot changes only draft, and later publication still uses global heads", async () => {
  const h = contentWriteFixture(), ancestorId = "20000000-0000-4000-8000-000000000003";
  h.tables.contentRevision.push({ ...structuredClone(h.tables.contentRevision[1]), id: ancestorId, versionNumber: 17 });
  const original = structuredClone(h.tables.contentRevision);
  await mutate({ adminId, scope: h.id + ":restore:" + ancestorId, intent: "restore-revision", contentId: h.id, revisionId: ancestorId, key: "restore-key-000001", fingerprint: { match: "old" }, change: a => restoreRevision(a!, ancestorId, draftEtag(a!.draft)) }, h.client);
  assert.equal(h.control.snapshotReads, 1); assert.deepEqual(h.tables.contentRevision, original); assert.equal(h.tables.content[0].publishedRevisionId, publishedId); assert.equal(h.tables.contentDraft[0].basedOnRevisionId, ancestorId);
  const result = await mutate(publishOptions(h), h.client) as { revision: { versionNumber: number; publishedEditionNumber: number; restoredFromRevisionId: string } };
  assert.equal(result.revision.versionNumber, 1000001); assert.equal(result.revision.publishedEditionNumber, 601); assert.equal(result.revision.restoredFromRevisionId, ancestorId);
});
test("stale conditional writes and changed same-key requests cannot append versions", async () => {
  const h = contentWriteFixture(); await assert.rejects(mutate({ ...publishOptions(h), change: a => publish(a!, '"stale"', stateEtag(a!.state)) }, h.client), e => e instanceof DomainError && e.status === 412); assert.equal(h.tables.contentRevision.length, 2);
  await mutate(publishOptions(h), h.client);
  await assert.rejects(mutate({ ...publishOptions(h), fingerprint: { changed: true } }, h.client), e => e instanceof DomainError && e.code === "IDEMPOTENCY_MISMATCH"); assert.equal(h.tables.contentRevision.length, 3);
});
test("making private remains possible without parsing unrelated damaged old snapshots", async () => {
  const h = contentWriteFixture(); h.tables.contentRevision[1].snapshot = { corrupt: true };
  await mutate({ adminId, scope: h.id + ":make-private", intent: "state", contentId: h.id, key: "private-key-000001", fingerprint: {}, change: a => changeState(a!, "make-private", stateEtag(a!.state)) }, h.client);
  assert.equal(h.tables.content[0].effectiveVisibility, "PRIVATE"); assert.equal(h.tables.contentSearchDocument.length, 0); assert.equal(h.control.snapshotReads, 0);
});

test("sparse save or restore contexts cannot silently restart counters when misused to create a version", async () => {
  const h = contentWriteFixture();
  for (const intent of ["save", "restore-revision"] as const) {
    const context = await loadWriteContext(h.tx, h.id, adminId, intent, intent === "restore-revision" ? manualId : undefined);
    assert.equal(context.revisionsComplete, false);
    assert.throws(() => snapshot(context, draftEtag(context.draft)), e => e instanceof DomainError && e.status === 500);
  }
});
test("publication refuses ambiguous canonical routes or missing publication counters", async () => {
  const h = contentWriteFixture(); h.tables.contentRoute.push({ path: "/knowledge/another-canonical", contentId: h.id, routeKind: "CANONICAL" });
  await assert.rejects(loadWriteContext(h.tx, h.id, adminId, "publish"), e => e instanceof DomainError && e.status === 500);
  const missing = contentWriteFixture(); missing.tables.contentRevision = missing.tables.contentRevision.filter(r => r.revisionKind !== "PUBLISHED");
  await assert.rejects(loadWriteContext(missing.tx, missing.id, adminId, "publish"), e => e instanceof DomainError && e.status === 500);
});
test("an incompatible targeted snapshot is refused without rewriting the draft", async () => {
  const h = contentWriteFixture(); (h.tables.contentRevision[1].snapshot as { module: string; desiredPath: string }).module = "LIFE"; (h.tables.contentRevision[1].snapshot as { desiredPath: string }).desiredPath = "/life/other";
  await assert.rejects(loadWriteContext(h.tx, h.id, adminId, "restore-revision", manualId), e => e instanceof DomainError && e.status === 500);
  assert.equal((h.tables.contentDraft[0].draftPayload as { module: string }).module, "KNOWLEDGE");
});
