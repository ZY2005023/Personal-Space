import { z } from "zod";
import { changeState, createContent, DomainError, PayloadSchema, publish, restoreRevision, saveDraft, snapshot, viewAdmin } from "@/lib/domain";
import { mutate } from "@/lib/content-store";
import { key, ok, problem, readJson, requireAdminSession } from "@/lib/http";
import { db } from "@/lib/db";
import { listTaxonomy, readTaxonomy, writeTaxonomy } from "@/lib/taxonomy-store";
import { decodePageCursor, finishPage } from "@/lib/pagination";
import { taxonomyEtag } from "@/lib/taxonomy";
import { deleteMedia, getMedia, listMedia, uploadMedia } from "@/lib/media-store";
import { MediaStatus, mediaView, readImageUpload, Variant } from "@/lib/media";
import { adminFilters, adminPage, getAdminModel, getAdminState, getRevision, revisionPage } from "@/lib/admin-read-store";
import { adminImage } from "@/lib/media-response";
import { auditFilters, auditPage } from "@/lib/audit-store";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { backupPage, drillPage, readBackup, recordPageInput } from "@/lib/backup-read-store";
import { createExport, downloadExport, getOperationJob } from "@/lib/export-store";
import { exportRuntime } from "@/lib/export-artifacts";
import { tokenHash } from "@/lib/auth-policy";
import { createBackup } from "@/lib/backup-store";
import { backupRuntime } from "@/lib/backup-runtime";
import { logRequest } from "@/lib/logger";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ segments: string[] }> };
async function handle(request: Request, context: Context, requestId: string) {
  try {
    const session = await requireAdminSession(request), adminId = session.user.id;
    const { segments: s } = await context.params; const method = request.method;
    if (s[0] === "exports") {
      if (s.length === 1 && method === "POST") {
        exportRuntime();
        if (!session.csrfToken || !session.sessionVersion) throw new DomainError(401, "UNAUTHENTICATED", "请重新登录");
        const result = await createExport({ adminId, sessionHash: tokenHash(session.csrfToken), sessionVersion: session.sessionVersion }, await readJson(request), key(request), request.headers.get("x-reauth-token") || "");
        return ok(result, 202, { Location: "/api/v1/admin/jobs/" + (result as { id: string }).id, "Retry-After": "3" });
      }
      if (s.length === 3 && s[2] === "download" && method === "GET") { if (!z.uuid().safeParse(s[1]).success) throw new DomainError(404, "NOT_FOUND", "导出不存在"); const runtime = exportRuntime(); return await downloadExport(adminId, s[1].toLowerCase(), runtime.store, runtime.config.maxBytes); }
    }
    if (s[0] === "backups" && s.length === 1 && method === "POST") {
      backupRuntime(); if (!session.csrfToken || !session.sessionVersion) throw new DomainError(401, "UNAUTHENTICATED", "请重新登录");
      const result = await createBackup({ adminId, sessionHash: tokenHash(session.csrfToken), sessionVersion: session.sessionVersion }, key(request), request.headers.get("x-reauth-token") || "");
      return ok(result, 202, { Location: "/api/v1/admin/jobs/" + (result as { id: string }).id, "Retry-After": "3" });
    }
    if (s[0] === "backups" && method === "GET") {
      if (s.length === 1) return Response.json(await backupPage(adminId, recordPageInput(new URL(request.url).searchParams)), { headers: { "Cache-Control": "private, no-store" } });
      if (s.length === 2) return ok(await readBackup(s[1]));
    }
    if (s[0] === "restore-drills" && s.length === 1 && method === "GET") return Response.json(await drillPage(adminId, recordPageInput(new URL(request.url).searchParams)), { headers: { "Cache-Control": "private, no-store" } });
    if (s[0] === "settings" && s.length === 1 && ["GET", "PUT"].includes(method)) {
      const result = method === "GET" ? await readSettings() : await writeSettings(adminId, await readJson(request), request.headers.get("if-match"));
      return ok(result.data, 200, { ETag: result.etag });
    }
    if (s[0] === "audit-logs" && s.length === 1 && method === "GET") return Response.json(await auditPage(adminId, auditFilters(new URL(request.url).searchParams)), { headers: { "Cache-Control": "private, no-store" } });
    if (s[0] === "jobs" && s.length === 2 && method === "GET") {
      if (!z.uuid().safeParse(s[1]).success) throw new DomainError(404, "NOT_FOUND", "任务不存在");
      return ok(await getOperationJob(adminId, s[1]));
    }
    if (s[0] === "media") {
      if (s.length === 1 && method === "GET") {
        const params = new URL(request.url).searchParams, status = params.get("status");
        const parsedStatus = MediaStatus.safeParse(status);
        if (status !== null && !parsedStatus.success) throw new DomainError(400, "INVALID_INPUT", "图片状态筛选不正确");
        const filter = parsedStatus.success ? parsedStatus.data : undefined;
        const limit = Number(params.get("limit") ?? 30);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
        const filters = { catalog: "media", adminId, status: filter || null, sortVersion: 1 };
        const after = decodePageCursor(params.get("cursor"), filters); if (after) z.uuid().parse(after.id);
        const rows = await listMedia(adminId, filter, limit, after);
        const page = finishPage(rows.map(m => ({ ...mediaView(m), publishedAt: m.uploadedAt.toISOString() })), limit, filters);
        return Response.json({ data: page.data.map(({ publishedAt: _, ...m }) => m), meta: page.meta }, { headers: { "Cache-Control": "private, no-store" } });
      }
      if (s.length === 1 && method === "POST") {
        const idempotencyKey = key(request), file = await readImageUpload(request);
        const result = await uploadMedia(adminId, idempotencyKey, file);
        return ok(result, 202, { Location: "/api/v1/admin/jobs/" + (result as { job: { id: string } }).job.id, "Retry-After": "3" });
      }
      if (!z.uuid().safeParse(s[1]).success) throw new DomainError(404, "NOT_FOUND", "图片不存在");
      const id = s[1];
      if (s.length === 2 && method === "GET") return ok(mediaView(await getMedia(adminId, id)));
      if (s.length === 2 && method === "DELETE") { await deleteMedia(adminId, id, key(request)); return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } }); }
      if (s.length === 3 && method === "GET" && s[2] === "original") return await adminImage(adminId, id, "ORIGINAL");
      if (s.length === 3 && method === "GET" && s[2] === "image") return await adminImage(adminId, id, Variant.parse(new URL(request.url).searchParams.get("variant")));
      throw new DomainError(404, "NOT_FOUND", "接口不存在");
    }
    if (s[0] === "categories" || s[0] === "tags") {
      const kind = s[0];
      if (s.length === 1 && method === "GET") {
        const params = new URL(request.url).searchParams;
        const limit = z.coerce.number().int().min(1).max(100).parse(params.get("limit") ?? 50);
        const filters = { catalog: kind, sortVersion: 1 };
        const rows = await listTaxonomy(kind, limit, decodePageCursor(params.get("cursor"), filters));
        const page = finishPage(rows, limit, filters);
        const result = { data: page.data.map(({ createdAt: _, publishedAt: __, ...row }) => row), meta: page.meta };
        return Response.json(result, { headers: { "Cache-Control": "private, no-store", ETag: taxonomyEtag(result) } });
      }
      if (s.length === 2 && method === "GET") { const result = await readTaxonomy(kind, z.uuid().parse(s[1])); return ok(result.data, 200, { ETag: result.etag }); }
      if ((s.length === 1 && method === "POST") || (s.length === 2 && ["PUT", "DELETE"].includes(method))) {
        const result = await writeTaxonomy({ kind, adminId, id: s.length === 2 ? z.uuid().parse(s[1]) : undefined, method, body: method === "DELETE" ? null : await readJson(request), match: request.headers.get("if-match"), key: method === "PUT" ? undefined : key(request) });
        if (result.status === 204) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
        return ok(result.data, result.status, { ETag: result.etag });
      }
      throw new DomainError(404, "NOT_FOUND", "接口不存在");
    }
    if (s[0] === "security" && s.length === 1 && method === "GET") {
      const user = await db().adminUser.findUniqueOrThrow({ where: { id: adminId } });
      return ok({ mfaEnabled: user.mfaEnabled, sessionVersion: user.sessionVersion, unusedRecoveryCodeCount: await db().recoveryCode.count({ where: { adminId, usedAt: null } }) });
    }
    if (s[0] !== "contents") throw new DomainError(503, "FEATURE_NOT_READY", "此模块尚在接入中");
    if (s.length === 1) {
      if (method === "GET") {
        return Response.json(await adminPage(adminId, adminFilters(new URL(request.url).searchParams)), { headers: { "Cache-Control": "private, no-store" } });
      }
      if (method === "POST") {
        const body = z.strictObject({ type: z.enum(["MOMENT", "ARTICLE", "ALBUM"]), module: z.enum(["LIFE", "KNOWLEDGE"]) }).parse(await readJson(request));
        return ok(await mutate({ adminId, scope: "contents:create", intent: "create", key: key(request), fingerprint: body, change: () => createContent(body.type, body.module) }), 201);
      }
    }
    if (!z.uuid().safeParse(s[1]).success) throw new DomainError(404, "NOT_FOUND", "内容不存在");
    const id = s[1].toLowerCase(); const action = s[2];
    if (method === "GET") {
      if (action === "revisions" && s.length === 3) {
        const params = adminFilters(new URL(request.url).searchParams, 10);
        return Response.json(await revisionPage(adminId, id, params.limit, params.cursor), { headers: { "Cache-Control": "private, no-store" } });
      }
      if (action === "revisions" && s.length === 4) { if (!z.uuid().safeParse(s[3]).success) throw new DomainError(404, "NOT_FOUND", "版本不存在"); return ok(await getRevision(adminId, id, s[3].toLowerCase())); }
      if (s.length === 3 && action === "state") { const state = await getAdminState(adminId, id); return ok(state, 200, { ETag: state.stateEtag }); }
      if (s.length === 2 || s.length === 3 && action === "draft") {
        const model = await getAdminModel(adminId, id);
        if (s.length === 2) return ok(model);
        if (action === "draft") return ok(model.draft, 200, { ETag: model.draft.etag });
        return ok(model.state, 200, { ETag: model.state.stateEtag });
      }
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
      if (s.length !== 3 && !(s.length === 5 && s[4] === "restore")) throw new DomainError(404, "NOT_FOUND", "接口不存在");
      const revisionId = s[3] ? z.uuid().transform(value => value.toLowerCase()).parse(s[3]) : undefined;
      const data = await mutate({ adminId, scope: `${id}:${revisionId ? "restore:" + revisionId : "snapshot"}`, intent: revisionId ? "restore-revision" : "snapshot", contentId: id, revisionId, key: key(request), fingerprint: { match }, change: a => revisionId ? restoreRevision(a!, revisionId, match) : snapshot(a!, match), result: a => revisionId ? viewAdmin(a).draft : a.revisions.at(-1) });
      return ok(data, revisionId ? 200 : 201);
    }
    throw new DomainError(404, "NOT_FOUND", "接口不存在");
  } catch (error) { return problem(error, requestId); }
}
async function route(request: Request, context: Context) {
  const startedAt = Date.now(), requestId = crypto.randomUUID();
  try {
    const response = await handle(request, context, requestId);
    logRequest(request, response.status, startedAt, requestId);
    return response;
  } catch (error) {
    const response = problem(error, requestId);
    logRequest(request, response.status, startedAt, requestId, error instanceof DomainError ? error.code : "INTERNAL_ERROR");
    return response;
  }
}
export const GET = route; export const POST = route; export const PUT = route; export const DELETE = route;
