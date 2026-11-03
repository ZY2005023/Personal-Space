import { test } from "node:test";
import assert from "node:assert/strict";
import { CategoryInput, TagInput, matchTaxonomy, taxonomyEtag, validateCategory, type CategoryNode } from "../src/lib/taxonomy";
import { DomainError } from "../src/lib/domain";
const root = { id: "10000000-0000-4000-8000-000000000001", module: "LIFE" as const, parentId: null, name: "旅行", slug: "travel", sortOrder: 0, isSystem: false, deletedAt: null };
const child: CategoryNode = { ...root, id: "10000000-0000-4000-8000-000000000002", parentId: root.id, name: "城市", slug: "city" };
test("taxonomy names normalize width, whitespace and casing for duplicate detection", () => {
  assert.equal(TagInput.parse({ name: "  ＡＩ  学习  ", slug: "ai" }).name, "AI 学习");
  assert.throws(() => TagInput.parse({ name: "\u200b", slug: "a" }));
  assert.throws(() => TagInput.parse({ name: "合法", slug: "A/path" }));
  assert.throws(() => TagInput.parse({ name: "合法", slug: "a", isSystem: true }));
});
test("root and child collisions include names, slugs and deleted reservations", () => {
  for (const deletedAt of [null, new Date()]) {
    assert.throws(() => validateCategory({ ...root, name: "别名" }, [{ ...root, deletedAt }]), e => e instanceof DomainError && e.status === 409);
    assert.throws(() => validateCategory({ ...child, slug: "other" }, [root, { ...child, deletedAt }]), DomainError);
  }
  assert.doesNotThrow(() => validateCategory({ ...child, slug: root.slug, name: root.name }, [root]));
});
test("rejects self-parent, third level, cross-module parent and moving a tree too deep", () => {
  assert.throws(() => validateCategory({ ...root, parentId: root.id }, [root], root), DomainError);
  assert.throws(() => validateCategory({ ...child, parentId: child.id }, [root, child]), DomainError);
  assert.throws(() => validateCategory({ ...child, module: "KNOWLEDGE" }, [root]), DomainError);
  const other = { ...root, id: "10000000-0000-4000-8000-000000000003", slug: "other", name: "其他" };
  assert.throws(() => validateCategory({ ...root, parentId: other.id }, [root, child, other], root), DomainError);
});
test("system entries and deleted parents cannot bypass validation", () => {
  assert.throws(() => validateCategory(root, [{ ...root, isSystem: true }], { ...root, isSystem: true }), DomainError);
  assert.throws(() => validateCategory(child, [{ ...root, deletedAt: new Date() }]), DomainError);
  assert.doesNotThrow(() => validateCategory({ ...root, module: "KNOWLEDGE" }, [root], root));
  assert.throws(() => CategoryInput.parse({ ...root, id: undefined }), "strict input rejects server fields");
});
test("catalog conditional writes require exact strong ETag and distinguish missing/stale", () => {
  const value = { id: root.id, name: root.name, updatedAt: "2026-11-02T12:00:00.000Z" }, etag = taxonomyEtag(value);
  assert.doesNotThrow(() => matchTaxonomy(etag, value));
  for (const [match, status] of [[null, 428], ["*", 400], ["W/" + etag, 400], ['"old"', 412]] as const) assert.throws(() => matchTaxonomy(match, value), e => e instanceof DomainError && e.status === status);
});
