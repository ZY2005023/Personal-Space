import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Prisma, type OutboxEvent } from "../src/generated/prisma/client";
import { claimOutboxSql, runOutboxEvent } from "../src/lib/outbox-worker";
const eventId = "10000000-0000-4000-8000-000000000001", mediaId = "20000000-0000-4000-8000-000000000001";
function fixture() {
  const state = { event: { id: eventId, eventType: "MEDIA_DELETED", aggregateId: mediaId, payload: { mediaId }, status: "PENDING", attempts: 0, leaseUntil: null, leaseToken: null, nextAttemptAt: null, createdAt: new Date(), processedAt: null } as OutboxEvent | null, job: null as null | { id: string; jobType: string; payload: unknown; status?: string }, loseLease: false, failCompletion: false, writes: 0 };
  const tx = {
    $queryRaw: async (q: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(q) ? q.join("") : (q as Prisma.Sql).text;
      if (text.includes("WITH candidate")) {
        if (!state.event || state.event.status !== "PENDING" || state.event.eventType !== "MEDIA_DELETED") return [];
        state.event.status = "RUNNING"; state.event.attempts++; state.event.leaseToken = (q as Prisma.Sql).values[0] as string; return [{ id: eventId }];
      }
      return !state.loseLease && state.event?.status === "RUNNING" && state.event.leaseToken === values[1] ? [{ id: eventId }] : [];
    },
    outboxEvent: {
      findUniqueOrThrow: async () => structuredClone(state.event),
      update: async ({ data }: { data: Partial<OutboxEvent> }) => {
        if (data.status === "PROCESSED" && state.failCompletion) throw new Error("Commit unavailable");
        Object.assign(state.event!, data);
      },
    },
    operationJob: {
      findUnique: async () => structuredClone(state.job),
      create: async ({ data }: { data: NonNullable<typeof state.job> }) => { state.writes++; state.job = structuredClone(data); return state.job; },
    },
  };
  const client = { $transaction: async (fn: (tx: unknown) => unknown) => {
    const before = structuredClone({ event: state.event, job: state.job });
    try { return await fn(tx); } catch (e) { state.event = before.event; state.job = before.job; throw e; }
  } } as unknown as NonNullable<Parameters<typeof runOutboxEvent>[0]>;
  return { state, client };
}
test("outbox claims only implemented events, with due-time/expiry checks and skip-locked fencing", () => {
  const q = claimOutboxSql(eventId);
  assert.match(q.text, /event_type IN \('MEDIA_DELETED', 'CONTENT_STATE_CHANGED'\)/); assert.match(q.text, /FOR UPDATE SKIP LOCKED LIMIT 1/);
  assert.match(q.text, /next_attempt_at <= clock_timestamp\(\)/); assert.match(q.text, /lease_until <= clock_timestamp\(\)/);
  assert.match(q.text, /attempts = attempts \+ 1/); assert.deepEqual(q.values, [eventId]);
});
test("dispatch commits one deterministic cleanup job and processed event together", async () => {
  const f = fixture(); assert.equal(await runOutboxEvent(f.client), true);
  assert.deepEqual(f.state.job, { id: eventId, jobType: "MEDIA_GC", payload: { mediaId, sourceEventId: eventId } });
  assert.equal(f.state.event?.status, "PROCESSED"); assert.equal(f.state.event?.leaseToken, null); assert.ok(f.state.event?.processedAt);
  assert.equal(await runOutboxEvent(f.client), false); assert.equal(f.state.writes, 1);
});
test("a replay preserves an existing matching job without resetting its status", async () => {
  const f = fixture(); f.state.job = { id: eventId, jobType: "MEDIA_GC", payload: { mediaId, sourceEventId: eventId }, status: "SUCCEEDED" };
  await runOutboxEvent(f.client); assert.equal(f.state.writes, 0); assert.equal(f.state.job.status, "SUCCEEDED"); assert.equal(f.state.event?.status, "PROCESSED");
});
test("malformed, mismatched and extra-field payloads fail without cleanup jobs", async () => {
  for (const payload of [{ mediaId: "invalid" }, { mediaId: eventId }, { mediaId, storageKey: "arbitrary" }]) {
    const f = fixture(); f.state.event!.payload = payload; await runOutboxEvent(f.client);
    assert.equal(f.state.event?.status, "FAILED"); assert.equal(f.state.job, null); assert.equal(f.state.event?.processedAt, null);
  }
});
test("a deterministic ID collision cannot overwrite a different task", async () => {
  for (const job of [{ id: eventId, jobType: "MEDIA_PROCESS", payload: { mediaId } }, { id: eventId, jobType: "MEDIA_GC", payload: { mediaId: eventId, sourceEventId: eventId } }]) {
    const f = fixture(); f.state.job = structuredClone(job); await runOutboxEvent(f.client);
    assert.deepEqual(f.state.job, job); assert.equal(f.state.event?.status, "FAILED"); assert.equal(f.state.writes, 0);
  }
});
test("completion failure rolls back the job and retries at most five times", async () => {
  const f = fixture(); f.state.failCompletion = true;
  for (let i = 1; i <= 5; i++) {
    await runOutboxEvent(f.client); assert.equal(f.state.job, null); assert.equal(f.state.event?.attempts, i);
    assert.equal(f.state.event?.status, i === 5 ? "FAILED" : "PENDING");
    if (i < 5) assert.ok(f.state.event!.nextAttemptAt!.getTime() > Date.now());
  }
  const g = fixture(); g.state.failCompletion = true; await runOutboxEvent(g.client); g.state.failCompletion = false;
  await runOutboxEvent(g.client); assert.equal(g.state.event?.status, "PROCESSED"); assert.ok(g.state.job);
});
test("lost leases cannot enqueue, acknowledge or change retry state", async () => {
  const f = fixture(); f.state.loseLease = true; await runOutboxEvent(f.client);
  assert.equal(f.state.job, null); assert.equal(f.state.event?.status, "RUNNING"); assert.equal(f.state.writes, 0);
});
test("unknown events and empty queues remain untouched", async () => {
  const f = fixture(); f.state.event!.eventType = "UNIMPLEMENTED_EVENT"; assert.equal(await runOutboxEvent(f.client), false); assert.equal(f.state.event?.attempts, 0);
  f.state.event = null; assert.equal(await runOutboxEvent(f.client), false);
});
test("outbox command help and invalid arguments never open even a deliberately invalid database", () => {
  for (const script of ["outbox-worker", "media-worker"]) for (const [arg, status] of [["--help", 0], ["--unsupported", 1]] as const) {
    const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}.ts`, arg], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "deliberately-invalid" } });
    assert.equal(result.status, status); assert.doesNotMatch(result.stdout + result.stderr, /Prisma|connection|deliberately-invalid/);
  }
});
