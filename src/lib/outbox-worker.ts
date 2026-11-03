import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { DomainError, requestHash } from "./domain";

type Client = Pick<ReturnType<typeof db>, "$transaction">;
import { reconcileContentSearch } from "./search-reconciliation";
const deletion = z.object({ mediaId: z.uuid() }).strict();
const maxAttempts = 5;
/** Only events with an implemented handler are claimed. Unknown events stay pending. */
export function claimOutboxSql(token: string) {
  return Prisma.sql`WITH candidate AS (
    SELECT id FROM outbox_events WHERE event_type IN ('MEDIA_DELETED', 'CONTENT_STATE_CHANGED') AND (
      (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())) OR
      (status = 'RUNNING' AND lease_until <= clock_timestamp())
    ) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE outbox_events e SET status = 'RUNNING', attempts = attempts + 1,
    lease_token = ${token}::uuid, lease_until = clock_timestamp() + interval '1 minute'
    FROM candidate WHERE e.id = candidate.id RETURNING e.id`;
}
export async function runOutboxEvent(client: Client = db()): Promise<boolean> {
  const event = await client.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>(claimOutboxSql(randomUUID()));
    return rows.length ? tx.outboxEvent.findUniqueOrThrow({ where: { id: rows[0].id } }) : null;
  });
  if (!event) return false;
  const fence = async (tx: Prisma.TransactionClient) => (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM outbox_events WHERE id = ${event.id}::uuid AND status = 'RUNNING' AND lease_token = ${event.leaseToken}::uuid AND lease_until > clock_timestamp() FOR UPDATE`).length === 1;
  try {
    await client.$transaction(async tx => {
      if (!await fence(tx)) return;
      if (event.attempts > maxAttempts) throw new DomainError(422, "INVALID_INPUT", "事件重试耗尽");
      if (event.eventType === "CONTENT_STATE_CHANGED") {
        await reconcileContentSearch(tx, event.aggregateId, event.payload);
      } else {
        const parsed = deletion.safeParse(event.payload);
        if (event.eventType !== "MEDIA_DELETED" || !parsed.success || parsed.data.mediaId.toLowerCase() !== event.aggregateId.toLowerCase()) throw new DomainError(422, "INVALID_INPUT", "删除事件无效");
        // One deterministic job per event. This is a hand-off, never a deletion authorization.
        const payload = { mediaId: event.aggregateId.toLowerCase(), sourceEventId: event.id };
        const existing = await tx.operationJob.findUnique({ where: { id: event.id } });
        if (existing) {
          if (existing.jobType !== "MEDIA_GC" || requestHash(existing.payload) !== requestHash(payload)) throw new DomainError(422, "INVALID_INPUT", "事件任务标识冲突");
        } else {
          await tx.operationJob.create({ data: { id: event.id, jobType: "MEDIA_GC", payload } });
        }
      }
      await tx.outboxEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", processedAt: new Date(), leaseUntil: null, leaseToken: null, nextAttemptAt: null } });
    }, { timeout: 10_000 });
  } catch (error) {
    const permanent = error instanceof DomainError && error.status < 500;
    await client.$transaction(async tx => {
      if (!await fence(tx)) return;
      const failed = permanent || event.attempts >= maxAttempts;
      await tx.outboxEvent.update({ where: { id: event.id }, data: { status: failed ? "FAILED" : "PENDING", leaseUntil: null, leaseToken: null, processedAt: null, nextAttemptAt: failed ? null : new Date(Date.now() + Math.min(300_000, 30_000 * 2 ** (event.attempts - 1))) } });
    });
  }
  return true;
}
