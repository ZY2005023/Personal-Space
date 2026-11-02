import { test } from "node:test";
import assert from "node:assert/strict";
import { equal, totp, matchTotp } from "../src/lib/crypto";
import { paginate } from "../src/lib/pagination";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
test("TOTP matches RFC4226/6238 test material and only a bounded time window", () => {
  assert.equal(totp(secret, 1), "287082"); assert.equal(matchTotp(secret, "287082", 59_000), 1); assert.equal(matchTotp(secret, "287082", 300_000), null); assert.equal(matchTotp(secret, "28x082", 59_000), null); assert.equal(equal("abc", "abcd"), false);
});
test("signed pagination handles ties without duplicates and binds filter parameters", () => {
  const items = ["c", "b", "a"].map(id => ({ id, publishedAt: "2026-11-02T00:00:00.000Z" }));
  const page = paginate(items, 2, null, { module: "LIFE" }); assert.deepEqual(page.data.map(i => i.id), ["c", "b"]); assert.equal(page.meta.hasMore, true);
  const second = paginate(items, 2, page.meta.nextCursor, { module: "LIFE" }); assert.deepEqual(second.data.map(i => i.id), ["a"]); assert.equal(second.meta.hasMore, false);
  assert.throws(() => paginate(items, 2, page.meta.nextCursor, { module: "KNOWLEDGE" })); assert.throws(() => paginate(items, 2, page.meta.nextCursor + "tampered", { module: "LIFE" }));
});
