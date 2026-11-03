import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaView, readImageUpload, safeFilename } from "../src/lib/media";
import { DomainError } from "../src/lib/domain";
test("media DTO exposes no storage keys, uploader, checksum or deleted marker", () => {
  const row = { id: "id", originalFilename: "image.png", mimeType: "image/png", sizeBytes: 12n, width: 4, height: 3, capturedAt: null, captureTimeTrusted: false, uploadedAt: new Date(), processingStatus: "READY", storageKey: "private/key", checksumSha256: "secret", uploadedBy: "admin", deletedAt: null };
  const data = mediaView(row); assert.equal(data.sizeBytes, 12); assert.doesNotMatch(JSON.stringify(data), /storageKey|checksumSha256|uploadedBy|deletedAt|private\/key/);
  assert.throws(() => mediaView({ ...row, sizeBytes: 9007199254740992n }), DomainError);
});
test("file names cannot inject headers or directory paths", () => {
  assert.equal(safeFilename("../private\\photo\r\n.png"), ".._private_photo__.png");
  assert.equal(safeFilename("   "), "image"); assert.equal(safeFilename("a".repeat(300)).length, 200);
});
test("multipart upload accepts exactly one file and rejects extra or duplicate fields", async () => {
  const form = new FormData(); form.append("file", new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
  const request = () => new Request("http://localhost/upload", { method: "POST", body: form });
  const result = await readImageUpload(request()); assert.equal(result.filename, "photo.png"); assert.equal(result.mimeType, "image/png"); assert.deepEqual([...result.bytes], [1, 2, 3]);
  form.append("path", "forbidden"); await assert.rejects(readImageUpload(request()), e => e instanceof DomainError && e.status === 422);
  await assert.rejects(readImageUpload(new Request("http://localhost/upload", { method: "POST", body: "file=x" })), e => e instanceof DomainError && e.status === 415);
});
test("upload bounds both declared and chunked body sizes before multipart parsing", async () => {
  const headers = { "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "999999999" };
  await assert.rejects(readImageUpload(new Request("http://localhost/upload", { method: "POST", headers, body: "x" })), e => e instanceof DomainError && e.status === 413);
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost/upload", { method: "POST", headers: { "Content-Type": headers["Content-Type"] }, body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readImageUpload(request), e => e instanceof DomainError && e.status === 413); assert.equal(cancelled, true);
});
