import { z } from "zod";
import { db } from "./db";
import { DomainError } from "./domain";
import { decodePageCursor, finishPage } from "./pagination";
export type RecordPageInput = { limit: number; cursor: string | null };
export function recordPageInput(params: URLSearchParams): RecordPageInput {
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) throw new DomainError(400, "INVALID_INPUT", "分页参数重复");
  const limit = Number(params.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
  return { limit, cursor: params.get("cursor") };
}
function position(kind: string, adminId: string, input: RecordPageInput) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new DomainError(400, "INVALID_INPUT", "分页大小必须为1至100");
  const filters = { kind, adminId, sortVersion: 1 }, after = decodePageCursor(input.cursor, filters);
  if (after && (!z.uuid().safeParse(after.id).success || after.score !== 0)) throw new DomainError(400, "INVALID_INPUT", "分页游标无效");
  return { filters, after };
}
const backupSelect = { id: true, jobId: true, backupType: true, status: true, localStatus: true, integrityStatus: true, offsiteStatus: true, verifiedAt: true, startedAt: true, completedAt: true } as const;
type BackupRow = { id: string; jobId: string; backupType: string; status: string; localStatus: string; integrityStatus: string; offsiteStatus: string; verifiedAt: Date | null; startedAt: Date | null; completedAt: Date | null };
export function backupView(row: BackupRow) { return { ...row, verifiedAt: row.verifiedAt?.toISOString() || null, startedAt: row.startedAt?.toISOString() || null, completedAt: row.completedAt?.toISOString() || null }; }
export function backupPageQuery(adminId: string, input: RecordPageInput) {
  const { filters, after } = position("admin-backups", adminId, input);
  return { filters, args: { where: after ? { OR: [{ job: { createdAt: { lt: new Date(after.publishedAt) } } }, { job: { createdAt: new Date(after.publishedAt) }, id: { lt: after.id } }] } : {}, select: { ...backupSelect, job: { select: { createdAt: true } } }, orderBy: [{ job: { createdAt: "desc" as const } }, { id: "desc" as const }], take: input.limit + 1 } };
}
export async function backupPage(adminId: string, input: RecordPageInput, client: Pick<ReturnType<typeof db>, "backupRun"> = db()) {
  const query = backupPageQuery(adminId, input), rows = await client.backupRun.findMany(query.args);
  const page = finishPage(rows.map(({ job, ...row }) => ({ ...backupView(row), publishedAt: job.createdAt.toISOString() })), input.limit, query.filters);
  return { data: page.data.map(({ publishedAt: _, ...row }) => row), meta: page.meta };
}
export async function readBackup(id: string, client: Pick<ReturnType<typeof db>, "backupRun"> = db()) {
  if (!z.uuid().safeParse(id).success) throw new DomainError(404, "NOT_FOUND", "备份不存在");
  const row = await client.backupRun.findUnique({ where: { id: id.toLowerCase() }, select: backupSelect });
  if (!row) throw new DomainError(404, "NOT_FOUND", "备份不存在"); return backupView(row);
}
export function drillPageQuery(adminId: string, input: RecordPageInput) {
  const { filters, after } = position("admin-restore-drills", adminId, input);
  return { filters, args: { where: after ? { OR: [{ startedAt: { lt: new Date(after.publishedAt) } }, { startedAt: new Date(after.publishedAt), id: { lt: after.id } }] } : {}, select: { id: true, backupRunId: true, status: true, startedAt: true, completedAt: true, notes: true }, orderBy: [{ startedAt: "desc" as const }, { id: "desc" as const }], take: input.limit + 1 } };
}
export async function drillPage(adminId: string, input: RecordPageInput, client: Pick<ReturnType<typeof db>, "restoreDrill"> = db()) {
  const query = drillPageQuery(adminId, input), rows = await client.restoreDrill.findMany(query.args);
  const page = finishPage(rows.map(row => ({ ...row, notes: row.notes || "", startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() || null, publishedAt: row.startedAt.toISOString() })), input.limit, query.filters);
  return { data: page.data.map(({ publishedAt: _, ...row }) => row), meta: page.meta };
}
export type BackupSummary = ReturnType<typeof backupView>;
