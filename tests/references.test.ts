import { test } from "node:test";
import assert from "node:assert/strict";
import { createContent, DomainError, parseStoredPayload, PayloadSchema } from "../src/lib/domain";
import { assertNoReferences, mediaRows, resolveReferences, searchFields, type ReferenceCatalog } from "../src/lib/references";
const admin = "10000000-0000-4000-8000-000000000001", mediaId = "20000000-0000-4000-8000-000000000001", categoryId = "30000000-0000-4000-8000-000000000001", tagId = "40000000-0000-4000-8000-000000000001";
function setup() {
  const p = createContent("ALBUM", "LIFE").draft.payload; p.categoryId = categoryId; p.tagIds = [tagId];
  p.placements = [1, 2].map(n => ({ placementId: `50000000-0000-4000-8000-00000000000${n}`, mediaId, role: "ALBUM_PHOTO", caption: "说明" + n, altText: "山景" + n }));
  const catalog: ReferenceCatalog = { categories: [{ id: categoryId, module: "LIFE", name: "旅行", slug: "travel", deletedAt: null }], tags: [{ id: tagId, name: "ＡＩ", slug: "ai", deletedAt: null }], media: [{ id: mediaId, processingStatus: "READY", uploadedBy: admin, deletedAt: null }] };
  return { p, catalog };
}
test("same image may have independent placements with stable order, captions and alternative text", () => {
  const { p, catalog } = setup(); assert.doesNotThrow(() => resolveReferences(p, catalog, admin, true));
  const rows = mediaRows(p); assert.equal(rows[0].mediaId, rows[1].mediaId); assert.notEqual(rows[0].placementId, rows[1].placementId); assert.deepEqual(rows.map(r => r.sortOrder), [0, 1]); assert.equal(rows[1].caption, "说明2"); assert.equal(rows[1].altText, "山景2");
});
test("drafts may refer to pending media while publishing requires READY", () => {
  const { p, catalog } = setup(); catalog.media[0].processingStatus = "PROCESSING";
  assert.doesNotThrow(() => resolveReferences(p, catalog, admin)); assert.throws(() => resolveReferences(p, catalog, admin, true), e => e instanceof DomainError && e.code === "MEDIA_NOT_READY");
});
test("missing, soft-deleted and other-owner media are all refused", () => {
  for (const failure of ["missing", "deleted", "owner"]) { const { p, catalog } = setup(); if (failure === "missing") catalog.media = []; if (failure === "deleted") catalog.media[0].deletedAt = new Date(); if (failure === "owner") catalog.media[0].uploadedBy = "another-admin"; assert.throws(() => resolveReferences(p, catalog, admin), DomainError); }
});
test("category must exist in the same module and soft-deleted tags cannot create new references", () => {
  const { p, catalog } = setup(); catalog.categories[0].module = "KNOWLEDGE"; assert.throws(() => resolveReferences(p, catalog, admin), DomainError); catalog.categories[0].module = "LIFE"; catalog.tags[0].deletedAt = new Date(); assert.throws(() => resolveReferences(p, catalog, admin), DomainError);
});
test("labels come from server catalog and snapshots are detached from later taxonomy renames", () => {
  const { p, catalog } = setup(); p.taxonomySnapshot = { category: null, tags: [] }; const old = resolveReferences(p, catalog, admin); catalog.tags[0].name = "新标签"; assert.equal(old.tags[0].name, "ＡＩ"); assert.equal(resolveReferences(p, catalog, admin).tags[0].name, "新标签");
});
test("any remaining reference layer blocks deletion, even if all other layers are empty", () => {
  for (const layer of ["draft", "history", "publication", "children"]) assert.throws(() => assertNoReferences({ [layer]: 1 }), e => e instanceof DomainError && e.status === 409 && e.code === "RESOURCE_REFERENCED");
  assert.doesNotThrow(() => assertNoReferences({ draft: 0, history: 0, publication: 0 }));
});
test("stored payload parser rejects corrupt or unexpected snapshot fields before serialization", () => {
  const { p, catalog } = setup(); p.taxonomySnapshot = resolveReferences(p, catalog, admin); assert.deepEqual(parseStoredPayload(p), p); assert.throws(() => parseStoredPayload({ ...p, secretStorageKey: "must-not-leak" }), e => e instanceof DomainError && e.status === 500); assert.throws(() => parseStoredPayload({ ...p, taxonomySnapshot: null }), DomainError);
});
test("stored labels must belong to exactly the category and tags in the same snapshot", () => {
  const { p, catalog } = setup(); p.taxonomySnapshot = resolveReferences(p, catalog, admin);
  assert.throws(() => parseStoredPayload({ ...p, taxonomySnapshot: { ...p.taxonomySnapshot, tags: [] } }), DomainError);
  assert.throws(() => parseStoredPayload({ ...p, categoryId: null }), DomainError);
});
test("UUID casing is canonicalized before duplicate detection and FK lookup", () => {
  const p = createContent("ARTICLE", "KNOWLEDGE").draft.payload; const { taxonomySnapshot: _, ...input } = p;
  const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; assert.equal(PayloadSchema.safeParse({ ...input, tagIds: [lower, lower.toUpperCase()] }).success, false);
  const parsed = PayloadSchema.parse({ ...input, categoryId: lower.toUpperCase() }); assert.equal(parsed.categoryId, lower);
});
test("search projection normalizes full-width taxonomy text and only uses the supplied version", () => {
  const { p, catalog } = setup(); p.title = "正式标题"; p.taxonomySnapshot = resolveReferences(p, catalog, admin); const d = searchFields(p); assert.equal(d.tagsText, "AI"); p.title = "未发布标题"; assert.equal(d.title, "正式标题");
});
