import { test } from "node:test";
import assert from "node:assert/strict";
import { auditFilters, auditQuery, auditPage, auditActionLabel } from "../src/lib/audit-store";
import { DomainError } from "../src/lib/domain";
const adminId = "10000000-0000-4000-8000-000000000001", firstId = "20000000-0000-4000-8000-000000000002", secondId = "20000000-0000-4000-8000-000000000001";
const date = new Date("2026-11-03T04:00:00.000Z");
const row = (id: string) => ({ id, action: "content:publish", targetType: "CONTENT", targetId: adminId, requestId: null, createdAt: date });
function fixture(rows: ReturnType<typeof row>[]) {
  const calls: unknown[] = [];
  return { calls, client: { auditLog: { findMany: async (args: unknown) => { calls.push(args); return rows; } } } as unknown as NonNullable<Parameters<typeof auditPage>[2]> };
}
test("audit parameters support default bounds and page-only action filters", () => {
  assert.deepEqual(auditFilters(new URLSearchParams()), { limit: 20, cursor: null, action: undefined });
  assert.equal(auditFilters(new URLSearchParams("action=+MFA+"), true).action, "mfa");
  assert.equal(auditFilters(new URLSearchParams("action=ignored")).action, undefined);
  for (const input of ["limit=0", "limit=101", "limit=1.5", "limit=1&limit=2", "cursor=a&cursor=b"]) assert.throws(() => auditFilters(new URLSearchParams(input)), DomainError);
  assert.throws(() => auditFilters(new URLSearchParams({ action: "x".repeat(101) }), true), DomainError);
});
test("audit reads project the contract summary and scope to the current actor", () => {
  const query = auditQuery(adminId, { limit: 20, cursor: null });
  assert.equal(query.args.where.actorId, adminId); assert.equal(query.args.take, 21);
  assert.deepEqual(Object.keys(query.args.select).sort(), ["action", "createdAt", "id", "requestId", "targetId", "targetType"]);
  assert.deepEqual(query.args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
});
test("audit page uses last returned timestamp and UUID as its tie-breaking boundary", async () => {
  const f = fixture([row(firstId), row(secondId)]), page = await auditPage(adminId, { limit: 1, cursor: null }, f.client);
  assert.equal(page.data.length, 1); assert.equal(page.meta.hasMore, true); assert.ok(page.meta.nextCursor); assert.equal(page.data[0].createdAt, date.toISOString());
  assert.equal("publishedAt" in page.data[0], false);
  const next = auditQuery(adminId, { limit: 2, cursor: page.meta.nextCursor });
  assert.deepEqual(next.args.where.OR, [{ createdAt: { lt: date } }, { createdAt: date, id: { lt: firstId } }]);
});
test("audit cursors bind actor and action scope and reject tampering", async () => {
  const f = fixture([row(firstId), row(secondId)]), page = await auditPage(adminId, { limit: 1, cursor: null, action: "publish" }, f.client);
  for (const input of [{ limit: 1, cursor: page.meta.nextCursor, action: "delete" }, { limit: 1, cursor: page.meta.nextCursor + "x", action: "publish" }]) assert.throws(() => auditQuery(adminId, input), DomainError);
  assert.throws(() => auditQuery(secondId, { limit: 1, cursor: page.meta.nextCursor, action: "publish" }), DomainError);
});
test("empty and final audit pages terminate without a continuation cursor", async () => {
  for (const rows of [[], [row(firstId)]]) {
    const f = fixture(rows), page = await auditPage(adminId, { limit: 20, cursor: null }, f.client);
    assert.deepEqual(page.meta, { hasMore: false, nextCursor: null }); assert.equal(page.data.length, rows.length);
  }
});
test("invalid audit pagination fails before database calls", async () => {
  const f = fixture([]); await assert.rejects(auditPage(adminId, { limit: 0, cursor: null }, f.client), DomainError); assert.equal(f.calls.length, 0);
});
test("audit labels explain known operations and retain unknown actions", () => {
  assert.equal(auditActionLabel("content:publish"), "发布内容"); assert.equal(auditActionLabel("id:restore:revision-id"), "恢复历史版本"); assert.equal(auditActionLabel("PASSWORD_CHANGED"), "修改密码"); assert.equal(auditActionLabel("future-action"), "future-action");
});
