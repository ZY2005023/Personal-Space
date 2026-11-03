import { Prisma } from "../../src/generated/prisma/client";
import type { db } from "../../src/lib/db";
import { createContent } from "../../src/lib/domain";
export const adminId = "10000000-0000-4000-8000-000000000001", publishedId = "20000000-0000-4000-8000-000000000001", manualId = "20000000-0000-4000-8000-000000000002";
type Row = Record<string, unknown>;
export function contentWriteFixture() {
  const a = createContent("ARTICLE", "KNOWLEDGE", "2026-11-03T00:00:00.000Z"), id = a.state.id, now = new Date(a.state.updatedAt);
  const payload = { ...a.draft.payload, title: "工作草稿", bodyMarkdown: "草稿正文", desiredPath: "/knowledge/current", desiredVisibility: "PUBLIC" };
  const tables: Record<string, Row[]> = {
    content: [{ ...a.state, ownerId: adminId, publishedRevisionId: publishedId, publicationState: "PUBLISHED", effectiveVisibility: "PUBLIC", stateVersion: 7, firstPublishedAt: now, lastPublishedAt: now, updatedAt: now, createdAt: now }],
    contentDraft: [{ contentId: id, draftPayload: payload, revisionNumber: 42, basedOnRevisionId: publishedId, lastSavedAt: now, updatedAt: now, payloadSchemaVersion: 1 }],
    contentRevision: [
      { id: publishedId, contentId: id, versionNumber: 999999, publishedEditionNumber: 600, revisionKind: "PUBLISHED", snapshot: { ...payload, title: "正式版本" }, restoredFromRevisionId: null, createdAt: now },
      { id: manualId, contentId: id, versionNumber: 1000000, publishedEditionNumber: null, revisionKind: "MANUAL_SNAPSHOT", snapshot: { ...payload, title: "历史快照" }, restoredFromRevisionId: null, createdAt: now },
    ],
    contentRoute: [{ path: "/knowledge/current", contentId: id, routeKind: "CANONICAL" }, ...Array.from({ length: 200 }, (_, n) => ({ path: "/knowledge/old-" + n, contentId: id, routeKind: "ALIAS" }))],
    contentPublication: [{ contentId: id, revisionId: publishedId, title: "正式版本" }],
    contentSearchDocument: [{ contentId: id, revisionId: publishedId, title: "正式版本" }],
  };
  const reads: { table: string; method: string; args: Row }[] = [], writes: { table: string; method: string; data: Row | Row[] }[] = [], locks: string[] = [];
  const control = { failAudit: false, snapshotReads: 0 };
  const copy = <T,>(value: T): T => structuredClone(value);
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, value]) => {
    if (key === "adminId_operationScope_idempotencyKey") return matches(row, value as Row);
    if (value && typeof value === "object" && "in" in value) return (value as { in: unknown[] }).in.includes(row[key]);
    if (value && typeof value === "object" && "not" in value) return row[key] !== (value as { not: unknown }).not;
    return row[key] === value;
  });
  const api: Record<string, unknown> = { $queryRaw: async (q: Prisma.Sql | TemplateStringsArray) => { locks.push(Array.isArray(q) ? q.join("") : (q as Prisma.Sql).text); return []; } };
  for (const table of ["content", "contentDraft", "contentRevision", "contentRoute", "contentPublication", "contentSearchDocument", "draftMedia", "revisionMedia", "contentMedia", "draftCategory", "revisionCategory", "draftTag", "revisionTag", "contentTag", "category", "tag", "media", "auditLog", "outboxEvent", "idempotencyRecord"]) {
    tables[table] ||= [];
    const find = (method: string, args: Row = {}) => {
      reads.push({ table, method, args: copy(args) });
      if (table === "contentRevision" && method === "findMany") throw new Error("Unbounded history read refused by fixture");
      let rows = tables[table].filter(row => matches(row, args.where as Row));
      if (args.orderBy) { const [field, direction] = Object.entries(args.orderBy as Row)[0]; rows = [...rows].sort((a, b) => (a[field]! < b[field]! ? -1 : a[field] === b[field] ? 0 : 1) * (direction === "desc" ? -1 : 1)); }
      if (method !== "findMany") rows = rows.slice(0, 1); else if (typeof args.take === "number") rows = rows.slice(0, args.take);
      if (table === "contentRevision" && !(args.select as Row | undefined)) control.snapshotReads += rows.length;
      return rows.map(row => args.select ? Object.fromEntries(Object.keys(args.select as Row).map(key => [key, copy(row[key])])) : table === "content" && args.include ? { ...copy(row), draft: copy(tables.contentDraft.find(d => d.contentId === row.id) || null) } : copy(row));
    };
    api[table] = {
      findFirst: async (args: Row) => find("findFirst", args)[0] || null,
      findUnique: async (args: Row) => find("findUnique", args)[0] || null,
      findMany: async (args: Row) => find("findMany", args),
      create: async ({ data }: { data: Row }) => { if (table === "auditLog" && control.failAudit) throw new Error("Simulated audit failure"); writes.push({ table, method: "create", data: copy(data) }); tables[table].push({ id: table + "-" + tables[table].length, ...copy(data) }); return data; },
      createMany: async ({ data }: { data: Row[] }) => { writes.push({ table, method: "createMany", data: copy(data) }); tables[table].push(...copy(data)); return { count: data.length }; },
      update: async ({ where, data }: { where: Row; data: Row }) => { writes.push({ table, method: "update", data: copy(data) }); const row = tables[table].find(r => matches(r, where)); if (!row) throw new Error("Missing fixture row"); Object.assign(row, copy(data)); return row; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { writes.push({ table, method: "updateMany", data: copy(data) }); for (const row of tables[table].filter(r => matches(r, where))) Object.assign(row, copy(data)); return { count: 1 }; },
      deleteMany: async ({ where }: { where: Row }) => { writes.push({ table, method: "deleteMany", data: {} }); tables[table] = tables[table].filter(r => !matches(r, where)); },
      delete: async ({ where }: { where: Row }) => { tables[table] = tables[table].filter(r => !matches(r, where)); },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => { writes.push({ table, method: "upsert", data: copy(create) }); const row = tables[table].find(r => matches(r, where)); if (row) { Object.assign(row, copy(update)); return row; } tables[table].push(copy(create)); return create; },
    };
  }
  const tx = api as unknown as Prisma.TransactionClient;
  const client = { $transaction: async (fn: (tx: Prisma.TransactionClient) => unknown) => { const before = copy(tables); try { return await fn(tx); } catch (e) { for (const key of Object.keys(tables)) tables[key] = before[key]; throw e; } } };
  return { id, tx, client: client as unknown as Pick<ReturnType<typeof db>, "$transaction">, tables, reads, writes, locks, control };
}
