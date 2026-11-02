import { test } from "node:test";
import assert from "node:assert/strict";
import { changeState, createContent, DomainError, draftEtag, PayloadSchema, publish, requestHash, restoreRevision, saveDraft, snapshot, stateEtag, viewPublic } from "../src/lib/domain";
function editable() { const a = createContent("ARTICLE", "KNOWLEDGE"); a.draft.payload = { ...a.draft.payload, title: "知识笔记", bodyMarkdown: "最初的正文", desiredVisibility: "PUBLIC", desiredPath: "/knowledge/notes" }; return a; }
function publicItem() { const a = editable(); return publish(a, draftEtag(a.draft), stateEtag(a.state)); }
function code(fn: () => unknown, expected: string) { assert.throws(fn, e => e instanceof DomainError && e.code === expected); }
test("saving a draft never changes a published snapshot or public route", () => {
  const a = publicItem(), before = viewPublic(a);
  const next = saveDraft(a, { ...a.draft.payload, title: "未发布标题", bodyMarkdown: "未发布正文", desiredPath: "/knowledge/new-path" }, draftEtag(a.draft));
  assert.deepEqual(viewPublic(next), before); assert.equal(next.canonicalPath, "/knowledge/notes"); assert.notEqual(next.draft.payload.title, before.payload.title);
  assert.deepEqual(next.state, a.state, "draft save must not change the representation guarded by the state ETag");
});
test("stale draft conditions cannot silently overwrite another save", () => {
  const a = editable(), etag = draftEtag(a.draft), first = saveDraft(a, a.draft.payload, etag);
  code(() => saveDraft(first, a.draft.payload, etag), "DRAFT_CONFLICT");
});
test("publication checks effective-state version even when the published pointer did not change", () => {
  const a = publicItem(), privateItem = changeState(a, "make-private", stateEtag(a.state));
  assert.equal(a.state.publishedRevisionId, privateItem.state.publishedRevisionId);
  code(() => publish(privateItem, draftEtag(privateItem.draft), stateEtag(a.state)), "STATE_CONFLICT");
});
test("all required preconditions are mandatory; weak and wildcard ETags are rejected", () => {
  const a = editable(); code(() => publish(a, null, stateEtag(a.state)), "PRECONDITION_REQUIRED"); code(() => publish(a, draftEtag(a.draft), null), "PRECONDITION_REQUIRED"); code(() => saveDraft(a, a.draft.payload, "*"), "INVALID_INPUT"); code(() => saveDraft(a, a.draft.payload, 'W/"old"'), "INVALID_INPUT");
});
test("draft, snapshot and formal publication counters are independent", () => {
  const a = editable(), saved = saveDraft(a, a.draft.payload, draftEtag(a.draft)), manual = snapshot(saved, draftEtag(saved.draft)), published = publish(manual, draftEtag(manual.draft), stateEtag(manual.state));
  assert.equal(published.draft.revisionNumber, 3); assert.equal(published.revisions[0].versionNumber, 1); assert.equal(published.revisions[0].publishedEditionNumber, null); assert.equal(published.revisions[1].versionNumber, 2); assert.equal(published.revisions[1].publishedEditionNumber, 1);
});
test("history restore changes only the working draft", () => {
  const a = publicItem(), original = viewPublic(a), saved = saveDraft(a, { ...a.draft.payload, title: "第二版", bodyMarkdown: "第二版正文" }, draftEtag(a.draft));
  const second = publish(saved, draftEtag(saved.draft), stateEtag(saved.state)), live = viewPublic(second), restored = restoreRevision(second, original.revisionId, draftEtag(second.draft));
  assert.deepEqual(viewPublic(restored), live); assert.equal(restored.draft.payload.title, "知识笔记"); assert.equal(restored.revisions[0].payload.title, "知识笔记");
});
test("restoring the recycle bin always resets both effective and desired visibility", () => {
  const a = publicItem(), trash = changeState(a, "trash", stateEtag(a.state)), restored = changeState(trash, "restore", stateEtag(trash.state));
  assert.equal(restored.state.publicationState, "UNPUBLISHED"); assert.equal(restored.state.effectiveVisibility, "PRIVATE"); assert.equal(restored.draft.payload.desiredVisibility, "PRIVATE"); code(() => viewPublic(restored), "NOT_FOUND");
});
test("restoring an unpublished draft keeps NEVER_PUBLISHED with no pointer", () => {
  const a = editable(), trash = changeState(a, "trash", stateEtag(a.state)), restored = changeState(trash, "restore", stateEtag(trash.state)); assert.equal(restored.state.publicationState, "NEVER_PUBLISHED"); assert.equal(restored.state.publishedRevisionId, null);
});
test("route history resolves directly to the current canonical address and can switch back", () => {
  const a = publicItem(), saved = saveDraft(a, { ...a.draft.payload, desiredPath: "/knowledge/new" }, draftEtag(a.draft)), next = publish(saved, draftEtag(saved.draft), stateEtag(saved.state));
  assert.deepEqual(next.aliases, ["/knowledge/notes"]); const backDraft = saveDraft(next, { ...next.draft.payload, desiredPath: "/knowledge/notes" }, draftEtag(next.draft)), back = publish(backDraft, draftEtag(backDraft.draft), stateEtag(backDraft.state)); assert.equal(back.canonicalPath, "/knowledge/notes"); assert.deepEqual(back.aliases, ["/knowledge/new"]);
});
test("module mismatch, duplicate placements and inconsistent covers fail schema validation", () => {
  const a = editable(); assert.equal(PayloadSchema.safeParse({ ...a.draft.payload, taxonomySnapshot: undefined }).success, false);
  const { taxonomySnapshot: _, ...p } = a.draft.payload;
  assert.equal(PayloadSchema.safeParse({ ...p, type: "ALBUM" }).success, false);
  const photo = { placementId: "10000000-0000-4000-8000-000000000001", mediaId: "20000000-0000-4000-8000-000000000001", role: "INLINE", caption: "", altText: "" };
  assert.equal(PayloadSchema.safeParse({ ...p, placements: [photo, photo] }).success, false);
  assert.equal(PayloadSchema.safeParse({ ...p, placements: [photo, { ...photo, placementId: "30000000-0000-4000-8000-000000000001" }] }).success, true);
  assert.equal(PayloadSchema.safeParse({ ...p, coverMediaId: photo.mediaId }).success, false);
});
test("published snapshots are detached from mutable input and public response objects", () => {
  const a = editable(), p = publish(a, draftEtag(a.draft), stateEtag(a.state)); a.draft.payload.title = "mutated input"; const view = viewPublic(p); view.payload.title = "mutated response"; assert.equal(viewPublic(p).payload.title, "知识笔记");
});
test("idempotency hashes include conditions and ignore JSON object key order", () => {
  assert.equal(requestHash({ a: 1, b: 2 }), requestHash({ b: 2, a: 1 })); assert.notEqual(requestHash({ body: { x: 1 }, match: "v1" }), requestHash({ body: { x: 1 }, match: "v2" }));
});
test("empty content can be saved but not published", () => {
  const a = createContent("ARTICLE", "LIFE"); assert.doesNotThrow(() => saveDraft(a, a.draft.payload, draftEtag(a.draft))); code(() => publish(a, draftEtag(a.draft), stateEtag(a.state)), "INVALID_INPUT");
});
test("public reads exclude private, unpublished, trashed and never-published states", () => {
  const a = publicItem(); for (const action of ["make-private", "unpublish", "trash"] as const) code(() => viewPublic(changeState(a, action, stateEtag(a.state))), "NOT_FOUND"); code(() => viewPublic(editable()), "NOT_FOUND");
});
