import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { imageLimits, inspectImage, processImage } from "../src/lib/image-processing";
import { DomainError } from "../src/lib/domain";
test("image input rejects SVG, MIME spoofing, excessive bytes and corrupted files", async () => {
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"), e => e instanceof DomainError && e.status === 415);
  await assert.rejects(inspectImage(png, "image/jpeg"), DomainError);
  await assert.rejects(inspectImage(Buffer.alloc(imageLimits.bytes + 1), "image/png"), e => e instanceof DomainError && e.status === 413);
  await assert.rejects(processImage(png.subarray(0, 33), "image/png"), DomainError);
});
test("variants correct orientation, strip EXIF and never enlarge a small image", async () => {
  const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: "blue" } }).withMetadata({ orientation: 6, exif: { IFD0: { Artist: "Private author" } } }).jpeg().toBuffer();
  const saved = Buffer.from(input), output = await processImage(input, "image/jpeg");
  assert.deepEqual(input, saved); assert.equal(output.variants.length, 2);
  for (const variant of output.variants) { assert.equal(variant.width, 40); assert.equal(variant.height, 80); const m = await sharp(variant.bytes).metadata(); assert.equal(m.format, "webp"); assert.equal(m.exif, undefined); assert.equal(m.xmp, undefined); assert.equal(m.icc, undefined); assert.equal(m.orientation, undefined); }
});
test("large images resize to configured bounds and pixel limit is enforced", async () => {
  const input = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "green" } }).png().toBuffer();
  const output = await processImage(input, "image/png"); assert.deepEqual(output.variants.map(v => [v.width, v.height]), [[480, 240], [2560, 1280]]);
  const large = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(inspectImage(large, "image/png"), DomainError);
});
test("animated WebP is refused instead of silently publishing its first frame", async () => {
  const frames = Buffer.concat([Buffer.alloc(4 * 4 * 3, 20), Buffer.alloc(4 * 4 * 3, 220)]);
  const animated = await sharp(frames, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  await assert.rejects(inspectImage(animated, "image/webp"), e => e instanceof DomainError && e.status === 415);
});
test("APNG animation marker is rejected even when the decoder could read only one frame", async () => {
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).png().toBuffer();
  const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8); chunk.write("acTL", 4); chunk.writeUInt32BE(2, 8);
  const marked = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  await assert.rejects(inspectImage(marked, "image/png"), e => e instanceof DomainError && e.status === 415);
});
