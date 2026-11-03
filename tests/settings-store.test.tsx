import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteSettingsInput, defaultSiteProfile } from "../src/lib/site-settings";
import { readSettings, writeSettings } from "../src/lib/settings-store";
import { DomainError } from "../src/lib/domain";
import { Footer } from "../src/components/nav";
const adminId = "10000000-0000-4000-8000-000000000001";
function fixture() {
  const state = { row: null as null | { settingValue: unknown; updatedAt: Date; updatedBy: string }, audits: [] as unknown[], failAudit: false, locks: 0 };
  const tx = {
    $queryRaw: async () => { state.locks++; return []; },
    systemSetting: {
      findUnique: async ({ where }: { where: { settingKey: string } }) => { assert.equal(where.settingKey, "site.profile"); return structuredClone(state.row); },
      upsert: async ({ where, create, update }: { where: { settingKey: string }; create: NonNullable<typeof state.row>; update: NonNullable<typeof state.row> }) => { assert.equal(where.settingKey, "site.profile"); state.row = structuredClone(state.row ? update : create); return structuredClone(state.row); },
    },
    auditLog: { create: async (args: unknown) => { if (state.failAudit) throw new Error("audit failed"); state.audits.push(args); } },
  };
  const client = { ...tx, $transaction: async (fn: (tx: unknown) => unknown) => {
    const before = structuredClone({ row: state.row, audits: state.audits });
    try { return await fn(tx); } catch (error) { state.row = before.row; state.audits = before.audits; throw error; }
  } } as unknown as NonNullable<Parameters<typeof writeSettings>[3]> & NonNullable<Parameters<typeof readSettings>[0]>;
  return { state, client };
}
test("empty settings return existing site defaults and actual upload capabilities without writing", async () => {
  const f = fixture(), result = await readSettings(f.client);
  assert.equal(result.data.siteTitle, defaultSiteProfile.siteTitle); assert.equal(result.data.siteIntro, defaultSiteProfile.siteIntro);
  assert.equal(result.data.uploadMaxBytes, 10 * 1024 * 1024); assert.deepEqual(result.data.allowedMimeTypes, ["image/jpeg", "image/png", "image/webp"]);
  assert.equal(f.state.row, null); assert.equal(f.state.audits.length, 0); assert.match(result.etag, /^"settings-/);
});
test("site setting input allows only editable copy and enforces title/intro lengths", () => {
  assert.equal(SiteSettingsInput.parse({ siteTitle: "  My Site  ", siteIntro: "" }).siteTitle, "My Site");
  for (const input of [{ siteTitle: " ", siteIntro: "" }, { siteTitle: "x".repeat(101), siteIntro: "" }, { siteTitle: "site", siteIntro: "x".repeat(501) }, { siteTitle: "site", siteIntro: "", uploadMaxBytes: 999999999 }, { siteTitle: "site", siteIntro: "", allowedMimeTypes: ["unsafe"] }]) assert.equal(SiteSettingsInput.safeParse(input).success, false);
});
test("first save persists the profile and audit atomically and reads back its new ETag", async () => {
  const f = fixture(), initial = await readSettings(f.client), saved = await writeSettings(adminId, { siteTitle: "New Site", siteIntro: "line one\nline two" }, initial.etag, f.client);
  assert.equal(saved.data.siteTitle, "New Site"); assert.notEqual(saved.etag, initial.etag); assert.equal(f.state.row?.updatedBy, adminId); assert.equal(f.state.audits.length, 1); assert.equal(f.state.locks, 1);
  assert.deepEqual(await readSettings(f.client), saved);
});
test("missing, weak and stale versions cannot overwrite settings or append audits", async () => {
  const f = fixture(), initial = await readSettings(f.client), value = { siteTitle: "new", siteIntro: "intro" };
  for (const [match, status] of [[null, 428], ["*", 400], ['W/"old"', 400], ['"stale"', 412]] as const) {
    await assert.rejects(writeSettings(adminId, value, match, f.client), e => e instanceof DomainError && e.status === status); assert.equal(f.state.row, null); assert.equal(f.state.audits.length, 0);
  }
  await writeSettings(adminId, value, initial.etag, f.client);
  await assert.rejects(writeSettings(adminId, { ...value, siteTitle: "overwritten" }, initial.etag, f.client), e => e instanceof DomainError && e.status === 412);
  assert.equal(f.state.audits.length, 1);
});
test("same copy saved again still advances the version", async () => {
  const f = fixture(), initial = await readSettings(f.client), value = { siteTitle: "site", siteIntro: "intro" };
  const first = await writeSettings(adminId, value, initial.etag, f.client);
  const second = await writeSettings(adminId, value, first.etag, f.client); assert.notEqual(first.etag, second.etag);
  assert.equal(f.state.audits.length, 2);
});
test("audit failure rolls a settings update back including its version", async () => {
  const f = fixture(), initial = await readSettings(f.client); f.state.failAudit = true;
  await assert.rejects(writeSettings(adminId, { siteTitle: "failed", siteIntro: "" }, initial.etag, f.client));
  assert.deepEqual(await readSettings(f.client), initial); assert.equal(f.state.row, null); assert.equal(f.state.audits.length, 0);
});
test("invalid stored profile produces an explicit error instead of replacing user copy", async () => {
  const f = fixture(); f.state.row = { settingValue: { unknown: true }, updatedAt: new Date(), updatedBy: adminId };
  await assert.rejects(readSettings(f.client), e => e instanceof DomainError && e.status === 500);
});
test("public footer renders configured copy as text with no script interpretation", () => {
  const html = renderToStaticMarkup(<Footer siteTitle="<script>title</script>" siteIntro={'Intro <img src=x>\nSecond line'} />);
  assert.match(html, /&lt;script&gt;title/); assert.match(html, /&lt;img src=x&gt;/); assert.doesNotMatch(html, /<script>|<img/); assert.match(html, /Second line/);
});

import { siteMetadata, contentMetadata } from "../src/lib/public-metadata";
import { createContent } from "../src/lib/domain";
test("site metadata uses the configured name and introduction", () => {
  assert.deepEqual(siteMetadata({ siteTitle: "My Garden", siteIntro: "My intro" }), { title: { default: "My Garden · 记录生活，也整理所知", template: "%s · My Garden" }, description: "My intro" });
});
test("reading metadata uses the current public title and a compact summary", () => {
  const a = createContent("ARTICLE", "KNOWLEDGE"); a.draft.payload.title = "A note"; a.draft.payload.summary = "first\n   second " + "x".repeat(200);
  const value = contentMetadata({ id: a.state.id, revisionId: adminId, publishedEditionNumber: 1, publishedAt: new Date().toISOString(), canonicalPath: "/knowledge/note", payload: a.draft.payload });
  assert.equal(value.title, "A note"); assert.equal(value.description?.length, 160); assert.match(value.description!, /^first second/);
});
