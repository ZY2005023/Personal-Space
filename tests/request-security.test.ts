import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWriteProof } from "../src/lib/request-security";
import { DomainError } from "../src/lib/domain";
test("security mutations require both exact canonical Origin and a session CSRF proof", () => {
  const previous = process.env.AUTH_URL; process.env.AUTH_URL = "https://personal.example";
  const token = "a".repeat(64);
  const request = (origin?: string, csrf?: string) => new Request("https://personal.example/api/auth/security/password", { method: "POST", headers: { ...(origin ? { Origin: origin } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}) } });
  try {
    assert.doesNotThrow(() => assertWriteProof(request("https://personal.example", token), token));
    for (const [origin, csrf] of [[undefined, token], ["https://personal.example.evil.test", token], ["https://personal.example", undefined], ["https://personal.example", "wrong"]]) assert.throws(() => assertWriteProof(request(origin, csrf), token), e => e instanceof DomainError && e.status === 403);
    assert.throws(() => assertWriteProof(request("https://personal.example", token), undefined), DomainError);
  } finally { if (previous === undefined) delete process.env.AUTH_URL; else process.env.AUTH_URL = previous; }
});
