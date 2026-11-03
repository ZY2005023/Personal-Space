import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildContentArchive } from "../src/lib/content-export";
import { ZipArchive } from "../src/lib/zip-archive";
import { createContent, DomainError } from "../src/lib/domain";
import { checksum, type ObjectStore } from "../src/lib/object-store";
const adminId = "10000000-0000-4000-8000-000000000001", mediaId = "20000000-0000-4000-8000-000000000001", date = new Date("2026-11-03T06:00:00.000Z");
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function unpack(bytes: Buffer) {
  const result = spawnSync("python", ["-c", "import sys,io,zipfile,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode('utf-8') for n in z.namelist()},ensure_ascii=True))"], { input: bytes, encoding: "utf8", maxBuffer: 10*1024*1024 });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout) as Record<string,string>;
}
function fixture(count = 1, history = 2) {
  const bytes = Buffer.from("original image");
  const payload = createContent("ARTICLE", "KNOWLEDGE").draft.payload; payload.title = "草稿标题"; payload.bodyMarkdown = "草稿正文";
  const contents = Array.from({ length: count }, (_, n) => ({ id: id(n+1), ownerId: adminId, type: "ARTICLE", module: "KNOWLEDGE", publicationState: "PUBLISHED", effectiveVisibility: "PRIVATE", stateVersion: 9, publishedRevisionId: id(1000), firstPublishedAt: date, lastPublishedAt: date, deletedAt: n === 0 ? date : null, createdAt: date, updatedAt: date }));
  const revisions = Array.from({ length: history }, (_, n) => ({ contentId: id(1), id: id(n+1000), versionNumber: n+1, publishedEditionNumber: n%2 === 0 ? n/2+1 : null, revisionKind: n%2 === 0 ? "PUBLISHED" : "MANUAL_SNAPSHOT", restoredFromRevisionId: null, snapshot: { ...payload, title: `历史${n+1}`, bodyMarkdown: "历史正文" }, createdAt: date }));
  const media = [{ id: mediaId, uploadedBy: adminId, storageKey: `originals/${mediaId}/original`, originalFilename: "照片.png", mimeType: "image/png", sizeBytes: BigInt(bytes.length), checksumSha256: checksum(bytes), width: 10, height: 10, capturedAt: null, captureTimeTrusted: false, uploadedAt: date, processingStatus: "READY", deletedAt: null as Date | null }];
  const calls: { table: string; args: Record<string, any> }[] = []; let options: unknown;
  const project = (value: Record<string, unknown>, select: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => select[key]));
  const table = (name: string, values: Record<string, any>[]) => ({ findMany: async (args: Record<string, any>) => {
    calls.push({ table: name, args }); const where = args.where || {};
    const key = args.orderBy.versionNumber ? "versionNumber" : args.orderBy.path ? "path" : "id";
    return values.filter(row => (!where.ownerId || row.ownerId === where.ownerId) && (!where.uploadedBy || row.uploadedBy === where.uploadedBy) && (!where.contentId || row.contentId === where.contentId) && (where[key]?.gt === undefined || row[key] > where[key].gt)).sort((a,b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0).slice(0,args.take).map(row => project(row,args.select));
  } });
  const tx = {
    $executeRaw: async (q: TemplateStringsArray) => { assert.match(q.join(""), /READ ONLY|statement_timeout/); },
    $queryRaw: async () => [{ capturedAt: date }],
    content: table("content", contents),
    contentDraft: { findUnique: async ({ where }: { where: { contentId: string } }) => ({ draftPayload: payload, revisionNumber: 42, basedOnRevisionId: id(1000), lastSavedAt: date }) },
    contentRevision: table("contentRevision", revisions),
    contentRoute: table("contentRoute", [{ contentId: id(1), path: "/knowledge/note", routeKind: "CANONICAL" }, { contentId: id(1), path: "/knowledge/old", routeKind: "ALIAS" }]),
    category: table("category", [{ id: id(900), module: "KNOWLEDGE", parentId: null, name: "分类", slug: "category", sortOrder: 0, isSystem: false, deletedAt: null, createdAt: date, updatedAt: date }]),
    tag: table("tag", [{ id: id(901), name: "标签", slug: "tag", deletedAt: null, createdAt: date, updatedAt: date }]),
    media: table("media", media),
  };
  const client = { $transaction: async (fn: (tx: unknown) => unknown, value: unknown) => { options = value; return fn(tx); } } as unknown as NonNullable<Parameters<typeof buildContentArchive>[2]>;
  let reads = 0; const store: ObjectStore = { get: async (_, max) => { reads++; assert.equal(max, bytes.length); return bytes; }, putImmutable: async () => { throw new Error("Export must not write source objects"); } };
  return { client, calls, store, media, payload, revisions, options: () => options, reads: () => reads };
}
test("ZIP output is independently readable with UTF-8 filenames, sizes and CRCs", () => {
  const zip = new ZipArchive(10000); zip.add("目录/说明.txt", Buffer.from("你好")); zip.add("empty", Buffer.alloc(0));
  assert.deepEqual(unpack(zip.finish()), { "目录/说明.txt": "你好", empty: "" });
});
test("ZIP writer rejects duplicate/invalid paths and respects the total archive budget", () => {
  const zip = new ZipArchive(120); zip.add("a", Buffer.from("small"));
  for (const name of ["a", "../bad", "/absolute", "x//y", "x\\y"]) assert.throws(() => zip.add(name, Buffer.from("x")), DomainError);
  assert.throws(() => zip.add("b", Buffer.alloc(120)), DomainError); assert.equal(zip.finish().length <= 120, true);
});
test("content export contains separate drafts, all revision kinds, tombstones and path metadata", async () => {
  const f = fixture(), result = await buildContentArchive(adminId, { includeMedia: false, maxBytes: 100000 }, f.client, f.store), files = unpack(result.bytes);
  assert.equal(JSON.parse(files[`contents/${id(1)}/draft.json`]).revisionNumber, 42);
  assert.equal(JSON.parse(files[`contents/${id(1)}/revisions/1.json`]).revisionKind, "PUBLISHED"); assert.equal(JSON.parse(files[`contents/${id(1)}/revisions/2.json`]).revisionKind, "MANUAL_SNAPSHOT");
  assert.equal(JSON.parse(files[`contents/${id(1)}/state.json`]).deletedAt, date.toISOString());
  assert.ok(Object.keys(files).some(name => name.includes("routes-"))); assert.ok(Object.keys(files).some(name => name.startsWith("taxonomy/categories"))); assert.ok(Object.keys(files).some(name => name.startsWith("taxonomy/tags")));
  assert.equal(f.reads(), 0); assert.equal(result.sha256, checksum(result.bytes));
});
test("manifest records every payload checksum and size without source storage keys", async () => {
  const f = fixture(), result = await buildContentArchive(adminId, { includeMedia: true, maxBytes: 100000 }, f.client, f.store), files = unpack(result.bytes);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.capturedAt, date.toISOString()); assert.equal(manifest.files.length, Object.keys(files).length-1);
  for (const entry of manifest.files) { const body = Buffer.from(files[entry.path]); assert.equal(entry.sizeBytes, body.length); assert.equal(entry.sha256, checksum(body)); }
  assert.equal(files[`media/${mediaId}/original`], "original image"); assert.equal(f.reads(), 1);
  assert.doesNotMatch(files[`media/${mediaId}/metadata.json`], /storageKey|originals\//);
});
test("export data reads are scoped, paged, read-only and request repeatable-read isolation", async () => {
  const f = fixture(21, 21), result = await buildContentArchive(adminId, { includeMedia: false, maxBytes: 1000000 }, f.client, f.store);
  const files = unpack(result.bytes); assert.ok(files[`contents/${id(21)}/state.json`]); assert.ok(files[`contents/${id(1)}/revisions/21.json`]);
  assert.equal((f.options() as { isolationLevel: string }).isolationLevel, "RepeatableRead");
  for (const call of f.calls) { assert.ok(call.args.take <= 100); if (call.table === "content") assert.equal(call.args.where.ownerId, adminId); if (call.table === "media") assert.equal(call.args.where.uploadedBy, adminId); assert.equal("include" in call.args, false); }
});
test("media opt-out and soft-deleted media produce metadata with no object access", async () => {
  const f = fixture(); f.media[0].deletedAt = date;
  const result = await buildContentArchive(adminId, { includeMedia: true, maxBytes: 100000 }, f.client, f.store), files = unpack(result.bytes);
  assert.equal(f.reads(), 0); assert.equal(JSON.parse(files[`media/${mediaId}/metadata.json`]).originalIncluded, false); assert.equal(files[`media/${mediaId}/original`], undefined);
});
test("unavailable or corrupted originals fail the entire export rather than returning an incomplete ZIP", async () => {
  for (const kind of ["missing", "corrupt"]) {
    const f = fixture(), store = { ...f.store, get: async () => { if (kind === "missing") throw new Error("unavailable"); return Buffer.from("corrupt"); } };
    await assert.rejects(buildContentArchive(adminId, { includeMedia: true, maxBytes: 100000 }, f.client, store));
  }
});
test("a malformed historic payload or insufficient byte budget never returns a successful archive", async () => {
  const f = fixture(); f.revisions[0].snapshot.title = "x".repeat(241);
  await assert.rejects(buildContentArchive(adminId, { includeMedia: false, maxBytes: 100000 }, f.client, f.store), DomainError);
  const g = fixture(); await assert.rejects(buildContentArchive(adminId, { includeMedia: false, maxBytes: 200 }, g.client, g.store), DomainError);
});

test("ZIP preserves arbitrary binary original bytes without text conversion", () => {
  const zip = new ZipArchive(1000), body = Buffer.from([0, 255, 128, 13, 10, 0, 42]); zip.add("media/original", body);
  const result = spawnSync("python", ["-c", "import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(z.read('media/original').hex())"], { input: zip.finish(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), body.toString("hex"));
});
