import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { browseFilters, browseHref, browseValues } from "../src/lib/browse";
import { BrowseFeedback } from "../src/components/browse-feedback";
import { CatalogSelect } from "../src/components/catalog-select";
import { ContentCard } from "../src/components/content-card";
import { PageLinks } from "../src/components/page-links";
import { createContent, DomainError, viewPublic } from "../src/lib/domain";
const categoryId = "ABCDEF00-0000-4000-8000-000000000001", tagId = "20000000-0000-4000-8000-000000000001";
test("browse input normalizes search and UUIDs while preserving allowed scopes", () => {
  const value = browseFilters({ q: "  ＡＩ  ", categoryId, tagId, type: "ARTICLE" }, { search: true });
  assert.equal(value.q, "AI"); assert.equal(value.categoryId, categoryId.toLowerCase()); assert.equal(value.tagId, tagId);
  assert.equal(browseFilters({}, { module: "LIFE", type: "ALBUM" }).type, "ALBUM");
});
test("duplicate supported parameters are refused rather than selecting an arbitrary value", () => {
  for (const name of ["module", "type", "categoryId", "tagId", "cursor", "q"]) assert.throws(() => browseFilters({ [name]: ["a", "b"] }, { search: true }), DomainError);
});
test("bad UUID, type, module, long query and oversized cursor are recoverable input errors", () => {
  for (const raw of [{ categoryId: "bad" }, { tagId: "bad" }, { module: "private" }, { type: "unsupported" }, { q: "x".repeat(101) }, { cursor: "x".repeat(2049) }]) assert.throws(() => browseFilters(raw, { search: true }), e => e instanceof DomainError && e.status === 400);
});
test("fixed page scope cannot be overridden and knowledge cannot request moments or albums", () => {
  for (const [raw, scope] of [[{ module: "KNOWLEDGE" }, { module: "LIFE" }], [{ type: "ARTICLE" }, { type: "ALBUM" }], [{ type: "MOMENT" }, { module: "KNOWLEDGE" }]] as const) assert.throws(() => browseFilters(raw, scope), DomainError);
});
test("changing type preserves taxonomy and removes cursor for a fresh result list", () => {
  const filters = browseFilters({ categoryId, tagId, type: "ARTICLE", cursor: "old" }, { module: "LIFE" });
  const href = new URL(browseHref("/life", filters, { type: "MOMENT" }), "http://local");
  assert.equal(href.searchParams.get("categoryId"), categoryId.toLowerCase()); assert.equal(href.searchParams.get("tagId"), tagId); assert.equal(href.searchParams.get("type"), "MOMENT"); assert.equal(href.searchParams.has("cursor"), false);
});
test("pagination preserves every active search filter and escapes user input", () => {
  const filters = browseFilters({ q: "a & b", module: "LIFE", type: "ARTICLE", categoryId, tagId }, { search: true });
  const html = renderToStaticMarkup(<PageLinks base="/search" filters={browseValues(filters)} cursor="old" nextCursor="next+/="/>);
  assert.match(html, /q=a\+%26\+b/); assert.match(html, /module=LIFE/); assert.match(html, /type=ARTICLE/); assert.match(html, /tagId=/); assert.match(html, /categoryId=/); assert.match(html, /cursor=next%2B%2F%3D/);
});
test("cursor recovery link keeps valid filters but contains no failed cursor", () => {
  const base = browseHref("/search", { q: "hello", tagId, cursor: "invalid" });
  const html = renderToStaticMarkup(<BrowseFeedback base={base} cursor />);
  assert.match(html, /返回筛选结果第一页/); assert.match(html, /q=hello/); assert.doesNotMatch(html, /invalid/);
});
test("catalog select retains a selected value not present in the first page", () => {
  const html = renderToStaticMarkup(<CatalogSelect kind="categories" selected={categoryId} initial={{ data: [], meta: { hasMore: true, nextCursor: "signed" } }} />);
  assert.match(html, /已选分类/); assert.match(html, /selected=""/); assert.match(html, /加载更多分类/); assert.match(html, /type="button"/); assert.match(html, /name="categoryId"/);
});
test("catalog options respect page module and escape names while retaining child labels", () => {
  const html = renderToStaticMarkup(<CatalogSelect kind="categories" module="LIFE" initial={{ data: [{ id: categoryId, name: "<script>unsafe</script>", module: "LIFE", parentId: tagId }, { id: tagId, name: "other-module", module: "KNOWLEDGE" }], meta: { hasMore: false, nextCursor: null } }} />);
  assert.doesNotMatch(html, /<script>|other-module/); assert.match(html, /&lt;script&gt;/); assert.match(html, /— /);
});
test("catalog failures expose retry and live status without disabling existing selection", () => {
  const html = renderToStaticMarkup(<CatalogSelect kind="tags" selected={tagId} failed initial={{ data: [], meta: { nextCursor: null, hasMore: false } }} />);
  assert.match(html, /重试加载标签/); assert.match(html, /role="status"/); assert.match(html, /已选标签/); assert.doesNotMatch(html, /disabled=/);
});
test("content card links category and tags to its module using public labels", () => {
  const a = createContent("ARTICLE", "KNOWLEDGE"); a.state.publicationState = "PUBLISHED"; a.state.effectiveVisibility = "PUBLIC"; a.state.publishedRevisionId = tagId; a.state.lastPublishedAt = new Date().toISOString();
  a.draft.payload.taxonomySnapshot = { category: { id: categoryId.toLowerCase(), name: "category", slug: "category" }, tags: [{ id: tagId, name: "tag", slug: "tag" }] };
  const content = { id: a.state.id, revisionId: tagId, publishedEditionNumber: 1, publishedAt: a.state.lastPublishedAt, canonicalPath: "/knowledge/note", payload: a.draft.payload } as ReturnType<typeof viewPublic>;
  const html = renderToStaticMarkup(<ContentCard content={content}/>);
  assert.match(html, /href="\/knowledge\?categoryId=/); assert.match(html, /href="\/knowledge\?tagId=/); assert.match(html, /#tag/);
});

import { appendCatalogPage } from "../src/lib/catalog-page";
import { SearchScope } from "../src/components/search-scope";
test("catalog append updates duplicates without losing prior options", () => {
  const current = { data: [{ id: tagId, name: "before" }], meta: { hasMore: true, nextCursor: "first" } };
  const next = appendCatalogPage(current, { data: [{ id: tagId, name: "renamed" }, { id: categoryId, name: "new" }], meta: { hasMore: false, nextCursor: null } });
  assert.equal(next.data.length, 2); assert.equal(next.data[0].name, "renamed"); assert.equal(current.data[0].name, "before"); assert.equal(next.meta.hasMore, false);
});
test("catalog append rejects malformed, repeated and inconsistent continuation responses", () => {
  const current = { data: [], meta: { hasMore: true, nextCursor: "first" } };
  for (const value of [{ data: [{ id: "bad", name: "unsafe" }], meta: { hasMore: false, nextCursor: null } }, { data: [], meta: { hasMore: true, nextCursor: null } }, { data: [], meta: { hasMore: false, nextCursor: "next" } }, { data: [], meta: { hasMore: true, nextCursor: "first" } }]) assert.throws(() => appendCatalogPage(current, value));
});
test("knowledge search disables incompatible content types while life permits all types", () => {
  const knowledge = renderToStaticMarkup(<SearchScope initialModule="KNOWLEDGE"/>), life = renderToStaticMarkup(<SearchScope initialModule="LIFE"/>);
  assert.match(knowledge, /value="MOMENT" disabled=""/); assert.match(knowledge, /value="ALBUM" disabled=""/); assert.doesNotMatch(life, /disabled=/);
});
test("empty taxonomy does not add empty navigation to content", () => {
  const a = createContent("ARTICLE", "KNOWLEDGE");
  const html = renderToStaticMarkup(<ContentCard content={{ id: a.state.id, revisionId: tagId, publishedEditionNumber: 1, publishedAt: new Date().toISOString(), canonicalPath: "/knowledge/note", payload: a.draft.payload }}/>);
  assert.doesNotMatch(html, /aria-label="分类和标签"/);
});
