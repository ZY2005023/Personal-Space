import { test } from "node:test";
import assert from "node:assert/strict";
import { PrivateS3Store, assertObjectKey, collectBounded } from "../src/lib/object-store";
import type { S3Client } from "@aws-sdk/client-s3";
import { DomainError } from "../src/lib/domain";
const key = "originals/10000000-0000-4000-8000-000000000001/original";
test("object reader bounds chunked output and rejects a truncated declared response", async () => {
  let closed = false;
  async function* body() { try { yield Buffer.from("1234"); yield Buffer.from("5678"); } finally { closed = true; } }
  await assert.rejects(collectBounded(body(), 6), DomainError); assert.equal(closed, true);
  await assert.rejects(collectBounded(body(), 12, 10), DomainError);
  assert.equal((await collectBounded(body(), 8, 8)).toString(), "12345678");
});
test("immutable S3 writes include a conditional header and checksum without public ACL", async () => {
  let input: Record<string, unknown> = {};
  const client = { send: async (command: { input: Record<string, unknown> }) => { input = command.input; return {}; } } as unknown as S3Client;
  await new PrivateS3Store(client, "private-bucket").putImmutable(key, Buffer.from("original"), "image/png");
  assert.equal(input.IfNoneMatch, "*"); assert.equal(input.ACL, undefined); assert.equal(input.Key, key); assert.ok(input.ChecksumSHA256); assert.equal(input.CacheControl, "private, no-store");
  assert.throws(() => assertObjectKey("../../secret"), DomainError); assert.throws(() => assertObjectKey("https://public.example/image"), DomainError);
});
test("existing S3 objects are accepted only when bytes match exactly", async () => {
  let original = Buffer.from("original");
  const client = { send: async (command: { input: { IfNoneMatch?: string } }) => {
    if (command.input.IfNoneMatch) throw { $metadata: { httpStatusCode: 412 } };
    return { ContentLength: original.length, Body: (async function* () { yield original; })() };
  } } as unknown as S3Client;
  const store = new PrivateS3Store(client, "private-bucket"); await store.putImmutable(key, original, "image/png");
  original = Buffer.from("modified"); await assert.rejects(store.putImmutable(key, Buffer.from("original"), "image/png"), e => e instanceof DomainError && e.status === 409);
});
test("a stalled object body times out instead of holding a worker lease forever", async () => {
  const stalled: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  await assert.rejects(collectBounded(stalled, 100, undefined, 5), e => e instanceof DomainError && e.status === 503);
});

test("physical S3 cleanup targets a single registered object key", async () => {
  let sent: { name: string; input: Record<string, unknown> } | undefined;
  const client = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => { sent = { name: command.constructor.name, input: command.input }; return {}; } } as unknown as S3Client;
  await new PrivateS3Store(client, "private-bucket").delete(key);
  assert.equal(sent?.name, "DeleteObjectCommand"); assert.equal(sent?.input.Bucket, "private-bucket"); assert.equal(sent?.input.Key, key);
});
