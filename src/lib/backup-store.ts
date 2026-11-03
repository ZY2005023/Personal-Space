import { randomUUID } from "node:crypto";
import { db } from "./db";
import { requestHash, DomainError } from "./domain";
import { lockAdmin, consumeProof } from "./security-store";
import type { SecurityContext } from "./auth-policy";
import { jobView } from "./media";
export async function createBackup(context: SecurityContext, key: string, proof: string, client: Pick<ReturnType<typeof db>, "$transaction"> = db()) {
  const scope = "backups:create", hash = requestHash({ backupType: "MANUAL" });
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.adminId + ":" + scope + ":" + key}, 0))::text`;
    const old = await tx.idempotencyRecord.findUnique({ where: { adminId_operationScope_idempotencyKey: { adminId: context.adminId, operationScope: scope, idempotencyKey: key } } });
    if (old && old.expiresAt > new Date()) { if (old.requestHash !== hash) throw new DomainError(409, "IDEMPOTENCY_MISMATCH", "请求标识已用于其他参数"); return old.responseReference; }
    if (old) await tx.idempotencyRecord.delete({ where: { id: old.id } });
    await lockAdmin(tx, context); await consumeProof(tx, context, proof, "REAUTH", "BACKUP_CREATE");
    const backupId = randomUUID(), job = await tx.operationJob.create({ data: { jobType: "BACKUP", payload: { adminId: context.adminId, backupId, backupType: "MANUAL" } } });
    await tx.backupRun.create({ data: { id: backupId, jobId: job.id, backupType: "MANUAL" } });
    await tx.auditLog.create({ data: { actorId: context.adminId, action: "BACKUP_CREATED", targetType: "BACKUP", targetId: backupId, metadata: { jobId: job.id } } });
    const response = jobView(job); await tx.idempotencyRecord.create({ data: { adminId: context.adminId, operationScope: scope, idempotencyKey: key, requestHash: hash, status: "COMPLETED", responseStatus: 202, responseReference: response, expiresAt: new Date(Date.now() + 86400000) } }); return response;
  });
}
