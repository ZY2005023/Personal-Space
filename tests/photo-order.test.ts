import assert from "node:assert/strict";
import test from "node:test";
import { orderNewAlbumPhotos } from "../src/lib/photo-order";

const photo = (id: string, capturedAt: string | null, trusted = true, uploadedAt = "2026-01-01T00:00:00.000Z") => ({ id, capturedAt, captureTimeTrusted: trusted, uploadedAt });

test("new album photos prefer trusted capture time and fall back to upload order", () => {
  const ordered = orderNewAlbumPhotos([
    photo("late", "2026-03-03T00:00:00.000Z", true, "2026-01-01T00:00:00.000Z"),
    photo("missing", null, false, "2026-01-02T00:00:00.000Z"),
    photo("early", "2026-03-01T00:00:00.000Z", true, "2026-01-03T00:00:00.000Z"),
    photo("same-upload", "2026-03-02T00:00:00.000Z", true, "2026-01-02T00:00:00.000Z"),
  ]);
  assert.deepEqual(ordered.map(item => item.id), ["early", "same-upload", "late", "missing"]);
});

test("untrusted capture times are ignored and upload order breaks ties", () => {
  const ordered = orderNewAlbumPhotos([
    photo("b", "2026-01-01T00:00:00.000Z", false, "2026-01-02T00:00:00.000Z"),
    photo("a", "2020-01-01T00:00:00.000Z", false, "2026-01-02T00:00:00.000Z"),
    photo("c", "2020-01-01T00:00:00.000Z", true, "2026-01-03T00:00:00.000Z"),
  ]);
  assert.deepEqual(ordered.map(item => item.id), ["c", "a", "b"]);
});