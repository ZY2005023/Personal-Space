import { test } from "node:test";
import assert from "node:assert/strict";
import { withCredentials } from "../src/lib/credentials-store";
import { encryptSecret, decryptSecret, decryptTotp, encryptTotp, totp } from "../src/lib/crypto";
import { NewPassword, Username, hashPassword, newRecoveryCodes, verifyHash } from "../src/lib/auth-policy";
import { DomainError } from "../src/lib/domain";
import { authFixture, password, secret } from "./helpers/auth-fixture";
test("TOTP ciphertext authenticates its version, key and purpose, with a fresh IV each time", async () => {
  await authFixture(); const a = encryptTotp(secret), b = encryptTotp(secret); assert.notEqual(a, b); assert.equal(decryptTotp(a), secret);
  assert.throws(() => decryptSecret(a, "mfa-enrollment")); assert.throws(() => decryptTotp(a.replace("v1.", "v2.")));
  const parts = a.split("."); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1); assert.throws(() => decryptTotp(parts.join(".")));
  assert.equal(decryptSecret(encryptSecret(secret, "mfa-enrollment"), "mfa-enrollment"), secret);
});
test("password policy preserves spaces/unicode, uses Argon2id and recovery codes are independently hashed", async () => {
  assert.equal(Username.parse(" OWNER "), "owner"); assert.throws(() => Username.parse("root/admin")); assert.throws(() => NewPassword.parse("short"));
  const value = "  passphrase with spaces  ", encoded = await hashPassword(value); assert.match(encoded, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/); assert.equal(await verifyHash(encoded, value), true); assert.equal(await verifyHash(encoded, value.trim()), false);
  const recovery = await newRecoveryCodes(); assert.equal(new Set(recovery.codes).size, 10); assert.equal(await verifyHash(recovery.hashes[0], recovery.codes[0]), true); assert.equal(recovery.hashes.some(h => recovery.codes.includes(h)), false);
});
test("password and TOTP must both verify; a consumed step cannot be replayed", async () => {
  const f = await authFixture(), now = Date.now(), code = totp(secret, Math.floor(now / 30000)), input = { username: "owner", password, code, recovery: false };
  await assert.rejects(withCredentials({ ...input, password: "wrong" }, "LOGIN", async () => true, undefined, f.client, now), e => e instanceof DomainError && e.status === 401);
  assert.equal(await withCredentials(input, "LOGIN", async () => true, undefined, f.client, now), true);
  await assert.rejects(withCredentials(input, "LOGIN", async () => true, undefined, f.client, now), e => e instanceof DomainError && e.status === 401);
});
test("recovery codes consume once and failed verification does not roll back throttling", async () => {
  const f = await authFixture(), recovery = await newRecoveryCodes(); f.state.codes = [{ id: "code-id", adminId: f.state.admin!.id, codeHash: recovery.hashes[0], createdAt: new Date(), usedAt: null }];
  const input = { username: "owner", password, code: recovery.codes[0].toUpperCase(), recovery: true };
  assert.equal(await withCredentials(input, "LOGIN", async () => true, undefined, f.client), true);
  await assert.rejects(withCredentials(input, "LOGIN", async () => true, undefined, f.client), DomainError); assert.equal(f.attempts.get("admin"), 2);
});
test("credential changes during password verification cannot mint a fresh session", async () => {
  const f = await authFixture(), now = Date.now(); f.state.beforeTransaction = () => { f.state.admin!.sessionVersion++; };
  await assert.rejects(withCredentials({ username: "owner", password, code: totp(secret, Math.floor(now / 30000)), recovery: false }, "LOGIN", async () => true, undefined, f.client, now), DomainError);
  assert.equal(f.state.admin?.lastTotpStep, null);
});
test("failed transactional work restores factor consumption but keeps the independent attempt count", async () => {
  const f = await authFixture(), now = Date.now();
  await assert.rejects(withCredentials({ username: "owner", password, code: totp(secret, Math.floor(now / 30000)), recovery: false }, "LOGIN", async () => { throw new Error("fail commit"); }, undefined, f.client, now));
  assert.equal(f.state.admin?.lastTotpStep, null); assert.equal(f.attempts.get("admin"), 1);
});
test("eleventh authentication attempt is throttled before any factor can be consumed", async () => {
  const f = await authFixture();
  for (let n = 1; n <= 11; n++) await assert.rejects(withCredentials({ username: "owner", password: "wrong", code: "000000", recovery: false }, "LOGIN", async () => true, undefined, f.client), e => e instanceof DomainError && e.status === (n > 10 ? 429 : 401));
  assert.equal(f.state.admin?.lastTotpStep, null);
});
