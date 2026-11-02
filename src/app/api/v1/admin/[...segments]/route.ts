import { z } from "zod";
import { changeState, createContent, DomainError, draftEtag, PayloadSchema, publish, restoreRevision, saveDraft, snapshot, stateEtag, viewAdmin } from "@/lib/domain";
import { getContent, listAdmin, mutate } from "@/lib/content-store";
import { key, ok, problem, readJson, requireAdmin } from "@/lib/http";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ segments: string[] }> };
async function route(request: Request, context: Context) {
  try {
    const adminId = await requireAdmin(request);
    const { segments: s } = await context.params; const method = request.method;
    if (s[0] === "security" && s.length === 1 && method === "GET") {
      const user = await db().adminUser.findUniqueOrThrow({ where: { id: adminId } });
      return ok({ mfaEnabled: user.mfaEnabled, sessionVersion: user.sessionVersion, unusedRecoveryCodeCount: await db().recoveryCode.count({ where: { adminId, usedAt: null } }) });
    }
    if (s[0] !== "contents") throw new DomainError(503, "FEATURE_NOT_READY", "此模块尚在接入中");
    if (s.length === 1) {
      if (method === "GET") {
        const items = await listAdmin(new URL(request.url).searchParams.get("deleted") === "true");
        return Response.json({ data: items.map(a => ({ state: viewAdmin(a).state, draftTitle: a.draft.payload.title, draftRevisionNumber: a.draft.revisionNumber })), meta: { nextCursor: null, hasMore: false } }, { headers: { "Cache-Control": "private, no-store" } });
      }
      if (method === "POST") {
        const body = z.strictObject({ type: z.enum(["MOMENT", "ARTICLE", "ALBUM"]), module: z.enum(["LIFE", "KNOWLEDGE"]) }).parse(await readJson(request));
        return ok(await mutate({ adminId, scope: "contents:create", intent: "create", key: key(request), fingerprint: body, change: () => createContent(body.type, body.module) }), 201);
      }
    }
    const id = z.uuid().parse(s[1]); const action = s[2];
    if (method === "GET") {
      const a = await getContent(id);
      if (s.length === 2) return ok(viewAdmin(a));
      if (action === "draft" && s.length === 3) return ok(viewAdmin(a).draft, 200, { ETag: draftEtag(a.draft) });
      if (action === "state" && s.length === 3) return ok(viewAdmin(a).state, 200, { ETag: stateEtag(a.state) });
      if (action === "revisions" && s.length === 3) return Response.json({ data: [...a.revisions].sort((a, b) => b.versionNumber - a.versionNumber), meta: { nextCursor: null, hasMore: false } }, { headers: { "Cache-Control": "private, no-store" } });
      if (action === "revisions" && s.length === 4) { const r = a.revisions.find(r => r.id === s[3]); if (!r) throw new DomainError(404, "NOT_FOUND", "版本不存在"); return ok(r); }
    }
    const match = request.headers.get("if-match");
    if (method === "PUT" && action === "draft" && s.length === 3) {
      const body = PayloadSchema.parse(await readJson(request));
      const data = await mutate({ adminId, scope: `${id}:save`, intent: "save", contentId: id, fingerprint: { body, match }, change: a => saveDraft(a!, { ...body, taxonomySnapshot: { category: null, tags: [] } }, match), result: a => viewAdmin(a).draft });
      return ok(data, 200, { ETag: (data as { etag: string }).etag });
    }
    if (method === "POST" && action === "publish" && s.length === 3) {
      const raw = await readJson(request);
      if (!match || !raw?.expectedStateEtag) throw new DomainError(428, "PRECONDITION_REQUIRED", "请先读取草稿和线上版本");
      const body = z.strictObject({ expectedStateEtag: z.string() }).parse(raw);
      return ok(await mutate({ adminId, scope: `${id}:publish`, intent: "publish", contentId: id, key: key(request), fingerprint: { body, match }, change: a => publish(a!, match, body.expectedStateEtag), result: (a, before) => ({ content: viewAdmin(a), revision: a.revisions.at(-1), firstPublication: !before?.state.firstPublishedAt }) }));
    }
    if (method === "POST" && ["make-private", "unpublish", "trash", "restore"].includes(action) && s.length === 3) {
      return ok(await mutate({ adminId, scope: `${id}:${action}`, intent: "state", contentId: id, key: key(request), fingerprint: { match }, change: a => changeState(a!, action as "trash", match) }));
    }
    if (method === "POST" && action === "revisions") {
      const revisionId = s[3];
      if (s.length !== 3 && !(s.length === 5 && s[4] === "restore")) throw new DomainError(404, "NOT_FOUND", "接口不存在");
      const data = await mutate({ adminId, scope: `${id}:${revisionId ? "restore:" + revisionId : "snapshot"}`, intent: revisionId ? "restore-revision" : "snapshot", contentId: id, key: key(request), fingerprint: { match }, change: a => revisionId ? restoreRevision(a!, z.uuid().parse(revisionId), match) : snapshot(a!, match), result: a => revisionId ? viewAdmin(a).draft : a.revisions.at(-1) });
      return ok(data, revisionId ? 200 : 201);
    }
    throw new DomainError(404, "NOT_FOUND", "接口不存在");
  } catch (error) { return problem(error); }
}
export const GET = route; export const POST = route; export const PUT = route; export const DELETE = route;
