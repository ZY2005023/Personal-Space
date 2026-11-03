import { z } from "zod";
import { db } from "./db";
import { DomainError } from "./domain";
import { decodePageCursor, finishPage } from "./pagination";
export type AuditFilters = { limit: number; cursor: string | null; action?: string };
export function auditFilters(params: URLSearchParams, page = false): AuditFilters {
  const read = (name: string) => { if (params.getAll(name).length > 1) throw new DomainError(400, "INVALID_INPUT", "查询参数重复"); return params.get(name); };
  const limit = Number(read("limit") ?? 20), cursor = read("cursor"), action = page ? (read("action") || "").trim().toLowerCase() : "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || action.length > 100) throw new DomainError(400, "INVALID_INPUT", "查询条件不正确");
  return { limit, cursor, action: action || undefined };
}
export function auditQuery(adminId: string, input: AuditFilters) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
  const filters = { kind: "admin-audit", adminId, action: input.action || null, sortVersion: 1 }, after = decodePageCursor(input.cursor, filters);
  if (after && (!z.uuid().safeParse(after.id).success || after.score !== 0)) throw new DomainError(400, "INVALID_INPUT", "审计分页游标无效");
  return { filters, args: {
    where: { actorId: adminId, ...(input.action ? { action: { contains: input.action, mode: "insensitive" as const } } : {}), ...(after ? { OR: [{ createdAt: { lt: new Date(after.publishedAt) } }, { createdAt: new Date(after.publishedAt), id: { lt: after.id } }] } : {}) },
    select: { id: true, action: true, targetType: true, targetId: true, requestId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: input.limit + 1,
  } };
}
export async function auditPage(adminId: string, input: AuditFilters, client: Pick<ReturnType<typeof db>, "auditLog"> = db()) {
  const query = auditQuery(adminId, input), rows = await client.auditLog.findMany(query.args);
  const result = finishPage(rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), publishedAt: row.createdAt.toISOString() })), input.limit, query.filters);
  return { data: result.data.map(({ publishedAt: _, ...row }) => row), meta: result.meta };
}
const names: Record<string, string> = { SETTINGS_UPDATED: "更新站点设置", EXPORT_CREATED: "创建内容导出", BACKUP_CREATED: "创建手动备份", BACKUP_SCHEDULED: "创建计划备份", MEDIA_PURGED: "清理已删除媒体", create: "创建内容", save: "保存草稿", publish: "发布内容", snapshot: "创建快照", "make-private": "转为私密", unpublish: "撤回发布", trash: "移入回收站", restore: "恢复内容", delete: "删除", PASSWORD_CHANGED: "修改密码", REAUTHENTICATED: "再次验证", RECOVERY_CODES_RESET: "重置恢复码", SESSIONS_REVOKED: "撤销会话", MFA_REPLACED: "更换验证器" };
export function auditActionLabel(action: string) {
  if (action.includes(":restore:")) return "恢复历史版本";
  return names[action] || names[action.split(":").at(-1)!] || action;
}
