import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { backupPage, backupPageQuery, backupView, drillPage, drillPageQuery, readBackup, recordPageInput } from "../src/lib/backup-read-store";
import { BackupRecords } from "../src/components/backup-records";
import { DomainError } from "../src/lib/domain";
const adminId = "10000000-0000-4000-8000-000000000001", id = "20000000-0000-4000-8000-000000000002", otherId = "20000000-0000-4000-8000-000000000001", date = new Date("2026-11-03T05:00:00.000Z");
function row(key = id) { return { id: key, jobId: adminId, backupType: "MANUAL", status: "SUCCEEDED", localStatus: "SUCCEEDED", integrityStatus: "SUCCEEDED", offsiteStatus: "FAILED", startedAt: null, completedAt: date, verifiedAt: date }; }
function fixture(rows = [row(id), row(otherId)]) {
  const calls: unknown[] = [];
  const client = { backupRun: { findMany: async (args: unknown) => { calls.push(args); return rows.map(value => ({ ...value, job: { createdAt: date } })); }, findUnique: async (args: unknown) => { calls.push(args); return rows[0] || null; } }, restoreDrill: { findMany: async (args: unknown) => { calls.push(args); return rows.map(value => ({ id: value.id, backupRunId: adminId, status: "PASSED", startedAt: date, completedAt: date, notes: null })); } } } as unknown as NonNullable<Parameters<typeof backupPage>[2]> & NonNullable<Parameters<typeof drillPage>[2]>;
  return { calls, client };
}
test("backup record pagination validates shared bounds and duplicate parameters", () => {
  assert.deepEqual(recordPageInput(new URLSearchParams()), { limit: 20, cursor: null });
  for (const value of ["limit=0", "limit=101", "limit=2.5", "limit=1&limit=2", "cursor=a&cursor=b"]) assert.throws(() => recordPageInput(new URLSearchParams(value)), DomainError);
});
test("backup list orders by immutable job creation so pending rows with no startedAt can paginate", async () => {
  const f = fixture(), page = await backupPage(adminId, { limit: 1, cursor: null }, f.client);
  assert.equal(page.data.length, 1); assert.equal(page.data[0].startedAt, null); assert.equal(page.meta.hasMore, true); assert.equal("job" in page.data[0], false); assert.equal("publishedAt" in page.data[0], false);
  const next = backupPageQuery(adminId, { limit: 20, cursor: page.meta.nextCursor });
  assert.deepEqual(next.args.where.OR, [{ job: { createdAt: { lt: date } } }, { job: { createdAt: date }, id: { lt: id } }]); assert.equal(next.args.take, 21);
});
test("backup API projection contains contract fields without manifest paths or internal summaries", () => {
  const select = backupPageQuery(adminId, { limit: 20, cursor: null }).args.select;
  assert.equal("manifestPath" in select, false); assert.equal("errorSummary" in select, false); assert.equal("checksum" in select, false);
  const view = backupView(row()); assert.equal(view.offsiteStatus, "FAILED"); assert.equal(view.localStatus, "SUCCEEDED"); assert.equal(view.completedAt, date.toISOString());
});
test("backup detail normalizes UUIDs and distinguishes missing records", async () => {
  const f = fixture(); assert.equal((await readBackup(id.toUpperCase(), f.client)).id, id);
  const empty = fixture([]); await assert.rejects(readBackup(id, empty.client), e => e instanceof DomainError && e.status === 404);
  await assert.rejects(readBackup("bad", empty.client), DomainError); assert.equal(empty.calls.length, 1);
});
test("backup and drill cursors cannot cross their list or administrator scope", async () => {
  const f = fixture(), page = await backupPage(adminId, { limit: 1, cursor: null }, f.client);
  assert.throws(() => drillPageQuery(adminId, { limit: 1, cursor: page.meta.nextCursor }), DomainError);
  assert.throws(() => backupPageQuery(otherId, { limit: 1, cursor: page.meta.nextCursor }), DomainError);
});
test("restore drill list uses start-time/ID ties and returns nullable notes as contract text", async () => {
  const f = fixture(), page = await drillPage(adminId, { limit: 1, cursor: null }, f.client);
  assert.equal(page.data[0].notes, ""); assert.equal(page.data[0].startedAt, date.toISOString());
  assert.deepEqual(drillPageQuery(adminId, { limit: 1, cursor: page.meta.nextCursor }).args.where.OR, [{ startedAt: { lt: date } }, { startedAt: date, id: { lt: id } }]);
  const empty = fixture([]); assert.deepEqual((await drillPage(adminId, { limit: 20, cursor: null }, empty.client)).meta, { hasMore: false, nextCursor: null });
});
test("backup display keeps failed offsite status visible even when overall and local status succeed", () => {
  const html = renderToStaticMarkup(<BackupRecords rows={[backupView(row())]}/>);
  assert.match(html, /本地副本/); assert.match(html, /完整性校验/); assert.match(html, /异地副本/); assert.match(html, /record-failed/); assert.match(html, /失败/); assert.match(html, /record-success/);
});
