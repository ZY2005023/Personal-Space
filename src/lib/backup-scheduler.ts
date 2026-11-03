import { randomUUID } from "node:crypto";
import { db } from "./db";
import { DomainError, requestHash } from "./domain";
export function backupPlans(now: Date, time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new DomainError(503, "SERVICE_UNAVAILABLE", "备份时间须为HH:mm");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now), get = (type: string) => parts.find(part => part.type === type)!.value;
  let date = `${get("year")}-${get("month")}-${get("day")}`; const clock = `${get("hour")}:${get("minute")}`;
  if (clock < time) { const previous = new Date(`${date}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1); date = previous.toISOString().slice(0,10); }
  const monday = new Date(`${date}T00:00:00Z`); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return [{ type: "DAILY", period: date }, { type: "WEEKLY", period: monday.toISOString().slice(0,10) }, { type: "MONTHLY", period: date.slice(0,7) }, { type: "YEARLY", period: date.slice(0,4) }];
}
export async function scheduleBackups(now = new Date(), client: Pick<ReturnType<typeof db>, "$transaction" | "adminUser"> = db()) {
  if (process.env.BACKUP_AUTOMATIC !== "true") return 0;
  const plans = backupPlans(now, process.env.BACKUP_TIME || "03:00"); if (!plans.length) return 0;
  const admin = await client.adminUser.findFirst({ where: { mfaEnabled: true }, select: { id: true } }); if (!admin) throw new DomainError(503, "SERVICE_UNAVAILABLE", "管理员尚未初始化");
  let created = 0;
  for (const plan of plans) created += await client.$transaction(async tx => {
    const scope = "backup:schedule", key = `${plan.type}:${plan.period}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope + ":" + key}, 0))::text`;
    if (await tx.idempotencyRecord.findUnique({ where: { adminId_operationScope_idempotencyKey: { adminId: admin.id, operationScope: scope, idempotencyKey: key } } })) return 0;
    const backupId = randomUUID(), job = await tx.operationJob.create({ data: { jobType: "BACKUP", payload: { adminId: admin.id, backupId, backupType: plan.type } } });
    await tx.backupRun.create({ data: { id: backupId, jobId: job.id, backupType: plan.type } });
    await tx.idempotencyRecord.create({ data: { adminId: admin.id, operationScope: scope, idempotencyKey: key, requestHash: requestHash({ key }), status: "COMPLETED", responseStatus: 202, responseReference: { jobId: job.id }, expiresAt: new Date(now.getTime() + 400 * 86400000) } });
    await tx.auditLog.create({ data: { actorId: admin.id, action: "BACKUP_SCHEDULED", targetType: "BACKUP", targetId: backupId, metadata: { backupType: plan.type, period: plan.period } } }); return 1;
  });
  return created;
}
