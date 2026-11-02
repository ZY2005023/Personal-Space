import { db } from "./db";
import { Prisma } from "@/generated/prisma/client";
import { Aggregate, State, Revision, DomainError, viewAdmin, requestHash, isPublic, parseStoredPayload } from "./domain";
import { hydrateReferences, lockReferences, lockRows } from "./reference-store";
import { mediaRows, searchFields } from "./references";
type Tx = Prisma.TransactionClient;
const include = { draft: true, revisions: true, routes: true } as const;
type Row = Prisma.ContentGetPayload<{ include: typeof include }>;
export function aggregate(row: Row): Aggregate {
  if (!row.draft) throw new DomainError(500, "INTERNAL_ERROR", "工作草稿暂不可用");
  return { state: { id: row.id, type: row.type as State["type"], module: row.module as State["module"], publicationState: row.publicationState as State["publicationState"], effectiveVisibility: row.effectiveVisibility as State["effectiveVisibility"], stateVersion: row.stateVersion, publishedRevisionId: row.publishedRevisionId, firstPublishedAt: row.firstPublishedAt?.toISOString() || null, lastPublishedAt: row.lastPublishedAt?.toISOString() || null, deletedAt: row.deletedAt?.toISOString() || null, updatedAt: row.updatedAt.toISOString() },
    draft: { contentId: row.id, revisionNumber: row.draft.revisionNumber, basedOnRevisionId: row.draft.basedOnRevisionId, payload: parseStoredPayload(row.draft.draftPayload), lastSavedAt: row.draft.lastSavedAt.toISOString() },
    revisions: row.revisions.map(r => ({ id: r.id, contentId: r.contentId, versionNumber: r.versionNumber, publishedEditionNumber: r.publishedEditionNumber, revisionKind: r.revisionKind as Revision["revisionKind"], restoredFromRevisionId: r.restoredFromRevisionId, payload: parseStoredPayload(r.snapshot), createdAt: r.createdAt.toISOString() })),
    canonicalPath: row.routes.find(r => r.routeKind === "CANONICAL")?.path || null, aliases: row.routes.filter(r => r.routeKind === "ALIAS").map(r => r.path) };
}
export async function getContent(id: string, tx: Tx = db()) {
  const row = await tx.content.findUnique({ where: { id }, include });
  if (!row) throw new DomainError(404, "NOT_FOUND", "内容不存在"); return aggregate(row);
}
export async function listAdmin(deleted = false) {
  const rows = await db().content.findMany({ where: { deletedAt: deleted ? { not: null } : null }, include, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
  return rows.map(aggregate).sort((a, b) => {
    const recent = (a: Aggregate) => a.draft.lastSavedAt > a.state.updatedAt ? a.draft.lastSavedAt : a.state.updatedAt;
    return recent(b).localeCompare(recent(a)) || b.state.id.localeCompare(a.state.id);
  });
}
function json(value: unknown) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
export type MutationIntent = "create" | "save" | "publish" | "snapshot" | "restore-revision" | "state";
export async function persistAggregate(tx: Tx, a: Aggregate, adminId: string, before: Aggregate | null, intent: MutationIntent): Promise<Aggregate> {
  const existing = new Set(before?.revisions.map(r => r.id) || []);
  const added = a.revisions.filter(r => !existing.has(r.id));
  const draftChanged = !before || before.draft.revisionNumber !== a.draft.revisionNumber;
  const publishedChanged = !!a.state.publishedRevisionId && a.state.publishedRevisionId !== before?.state.publishedRevisionId;
  const payloads = [...(draftChanged ? [a.draft.payload] : []), ...added.map(r => r.payload)];
  await lockReferences(tx, payloads);
  const next = { ...a, draft: { ...a.draft }, revisions: [...a.revisions] };
  if (draftChanged) next.draft.payload = await hydrateReferences(tx, a.draft.payload, adminId, intent === "publish" || intent === "restore-revision");
  for (const revision of added) {
    const payload = await hydrateReferences(tx, revision.payload, adminId, revision.revisionKind === "PUBLISHED");
    next.revisions = next.revisions.map(r => r.id === revision.id ? { ...r, payload } : r);
  }
  const p = next.draft.payload;
  const s = a.state;
  await tx.content.upsert({ where: { id: s.id }, create: { id: s.id, ownerId: adminId, type: s.type, module: s.module }, update: {} });
  for (const r of next.revisions) if (!existing.has(r.id)) {
    await tx.contentRevision.create({ data: { id: r.id, contentId: r.contentId, versionNumber: r.versionNumber, publishedEditionNumber: r.publishedEditionNumber, revisionKind: r.revisionKind, snapshot: json(r.payload), restoredFromRevisionId: r.restoredFromRevisionId, createdAt: new Date(r.createdAt) } });
    const rows = mediaRows(r.payload); if (rows.length) await tx.revisionMedia.createMany({ data: rows.map(row => ({ ...row, revisionId: r.id })) });
    if (r.payload.categoryId) await tx.revisionCategory.create({ data: { revisionId: r.id, categoryId: r.payload.categoryId } });
    if (r.payload.tagIds.length) await tx.revisionTag.createMany({ data: r.payload.tagIds.map(tagId => ({ revisionId: r.id, tagId })) });
  }
  if (draftChanged) {
    await tx.contentDraft.upsert({ where: { contentId: s.id }, create: { contentId: s.id, draftPayload: json(p), revisionNumber: next.draft.revisionNumber, basedOnRevisionId: next.draft.basedOnRevisionId, lastSavedAt: new Date(next.draft.lastSavedAt) }, update: { draftPayload: json(p), revisionNumber: next.draft.revisionNumber, basedOnRevisionId: next.draft.basedOnRevisionId, lastSavedAt: new Date(next.draft.lastSavedAt) } });
    await tx.draftMedia.deleteMany({ where: { contentId: s.id } });
    const rows = mediaRows(p); if (rows.length) await tx.draftMedia.createMany({ data: rows.map(row => ({ ...row, contentId: s.id })) });
    await tx.draftCategory.deleteMany({ where: { contentId: s.id } });
    if (p.categoryId) await tx.draftCategory.create({ data: { contentId: s.id, categoryId: p.categoryId } });
    await tx.draftTag.deleteMany({ where: { contentId: s.id } });
    if (p.tagIds.length) await tx.draftTag.createMany({ data: p.tagIds.map(tagId => ({ contentId: s.id, tagId })) });
  }
  await tx.content.update({ where: { id: s.id }, data: { publicationState: s.publicationState, effectiveVisibility: s.effectiveVisibility, stateVersion: s.stateVersion, publishedRevisionId: s.publishedRevisionId, firstPublishedAt: s.firstPublishedAt ? new Date(s.firstPublishedAt) : null, lastPublishedAt: s.lastPublishedAt ? new Date(s.lastPublishedAt) : null, deletedAt: s.deletedAt ? new Date(s.deletedAt) : null, updatedAt: new Date(s.updatedAt) } });
  if (a.canonicalPath && s.publishedRevisionId && publishedChanged) {
    const paths = [...new Set([...a.aliases, a.canonicalPath])].sort();
    await tx.$queryRaw(Prisma.sql`SELECT path FROM content_routes WHERE path IN (${Prisma.join(paths)}) ORDER BY path FOR UPDATE`);
    for (const path of [...a.aliases, a.canonicalPath]) {
      const existingRoute = await tx.contentRoute.findUnique({ where: { path } });
      if (existingRoute && existingRoute.contentId !== s.id) throw new DomainError(409, "PATH_CONFLICT", "此地址已被使用，请选择其他地址");
    }
    await tx.contentRoute.updateMany({ where: { contentId: s.id, routeKind: "CANONICAL" }, data: { routeKind: "ALIAS" } });
    for (const path of [...a.aliases, a.canonicalPath]) await tx.contentRoute.upsert({ where: { path }, create: { path, contentId: s.id, routeKind: path === a.canonicalPath ? "CANONICAL" : "ALIAS" }, update: { routeKind: path === a.canonicalPath ? "CANONICAL" : "ALIAS" } });
    const r = next.revisions.find(r => r.id === s.publishedRevisionId)!;
    const projection = { revisionId: r.id, title: r.payload.title, summary: r.payload.summary, categoryId: r.payload.categoryId, coverMediaId: r.payload.coverMediaId, publishedAt: new Date(s.lastPublishedAt!) };
    await tx.contentPublication.upsert({ where: { contentId: s.id }, create: { contentId: s.id, ...projection }, update: projection });
    await tx.contentMedia.deleteMany({ where: { contentId: s.id } });
    const rows = mediaRows(r.payload); if (rows.length) await tx.contentMedia.createMany({ data: rows.map(row => ({ ...row, contentId: s.id })) });
    await tx.contentTag.deleteMany({ where: { contentId: s.id } });
    if (r.payload.tagIds.length) await tx.contentTag.createMany({ data: r.payload.tagIds.map(tagId => ({ contentId: s.id, tagId })) });
  }
  if (!isPublic(s)) await tx.contentSearchDocument.deleteMany({ where: { contentId: s.id } });
  else if (publishedChanged) {
    const r = next.revisions.find(r => r.id === s.publishedRevisionId)!;
    const document = { revisionId: r.id, ...searchFields(r.payload), publishedAt: new Date(s.lastPublishedAt!) };
    await tx.contentSearchDocument.upsert({ where: { contentId: s.id }, create: { contentId: s.id, ...document }, update: document });
  }
  if (!before || s.stateVersion !== before.state.stateVersion) await tx.outboxEvent.create({ data: { eventType: "CONTENT_STATE_CHANGED", aggregateId: s.id, payload: { stateVersion: s.stateVersion, revisionId: s.publishedRevisionId } } });
  return next;
}
export async function mutate(options: { adminId: string; scope: string; intent: MutationIntent; key?: string; fingerprint: unknown; contentId?: string; change: (a: Aggregate | null) => Aggregate; result?: (a: Aggregate, before: Aggregate | null) => unknown }) {
  const hash = requestHash(options.fingerprint);
  try {
    return await db().$transaction(async tx => {
      // Serialize only retries of the same idempotent operation, not unrelated contents.
      if (options.key) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${options.adminId + ":" + options.scope + ":" + options.key}, 0))::text`;
        const previous = await tx.idempotencyRecord.findUnique({ where: { adminId_operationScope_idempotencyKey: { adminId: options.adminId, operationScope: options.scope, idempotencyKey: options.key } } });
        if (previous && previous.expiresAt > new Date()) {
          if (previous.requestHash !== hash) throw new DomainError(409, "IDEMPOTENCY_MISMATCH", "该请求标识已用于其他参数");
          return previous.responseReference;
        }
        if (previous) await tx.idempotencyRecord.delete({ where: { id: previous.id } });
      }
      if (options.contentId) {
        await lockRows(tx, "contents", [options.contentId]);
        await tx.$queryRaw`SELECT content_id::text FROM content_drafts WHERE content_id = ${options.contentId}::uuid FOR UPDATE`;
      }
      const before = options.contentId ? await getContent(options.contentId, tx) : null;
      const next = await persistAggregate(tx, options.change(before), options.adminId, before, options.intent);
      await tx.auditLog.create({ data: { actorId: options.adminId, action: options.scope, targetType: "CONTENT", targetId: next.state.id, metadata: { stateVersion: next.state.stateVersion, draftVersion: next.draft.revisionNumber } } });
      const result = options.result ? options.result(next, before) : viewAdmin(next);
      if (options.key) await tx.idempotencyRecord.create({ data: { adminId: options.adminId, operationScope: options.scope, idempotencyKey: options.key, requestHash: hash, status: "COMPLETED", responseStatus: options.intent === "create" || options.intent === "snapshot" ? 201 : 200, responseReference: json(result), expiresAt: new Date(Date.now() + 86_400_000) } });
      return result;
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DomainError(409, "PATH_CONFLICT", "地址或版本存在冲突，请重新获取最新内容");
    throw e;
  }
}
