import { test } from "node:test";
import assert from "node:assert/strict";
import { loginAdministrator } from "../src/lib/admin-login";
import { beginRecoveryMfa } from "../src/lib/recovery-login";
import { cancelMfaReplacement, changePassword, confirmMfaReplacement, resetRecoveryCodes, revokeOnSignOut } from "../src/lib/security-store";
import { csrfForNonce, newRecoveryCodes, tokenHash } from "../src/lib/auth-policy";
import { decryptTotp, totp } from "../src/lib/crypto";
import { DomainError } from "../src/lib/domain";
import { authFixture, password, secret } from "./helpers/auth-fixture";
async function recovered() {
  process.env.AUTH_SECRET = "test-auth-secret-not-for-real-use-0001";
  const f = await authFixture(), recovery = await newRecoveryCodes();
  f.state.codes = [{ id: "last-recovery-code", adminId: f.state.admin!.id, codeHash: recovery.hashes[0], usedAt: null, createdAt: new Date() }];
  const user = await loginAdministrator({ username: "owner", password, code: recovery.codes[0], recovery: true }, f.client);
  const context = { adminId: user.id, sessionVersion: user.sessionVersion, sessionHash: tokenHash(csrfForNonce(user.csrfNonce)) };
  return { ...f, context, code: recovery.codes[0] };
}
test("last recovery code logs in once and can replace the lost factor without consuming another code", async () => {
  const f = await recovered(); assert.ok(f.state.codes[0].usedAt); assert.equal(f.state.challenges[0].sessionHash, f.context.sessionHash);
  const enrollment = await beginRecoveryMfa(f.context, password, f.client);
  assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), secret);
  const result = await confirmMfaReplacement(f.context, enrollment.bindingToken, totp(enrollment.secret, Math.floor(Date.now() / 30000)), f.client);
  assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), enrollment.secret); assert.equal(result.recoveryCodes.length, 10); assert.equal(f.state.codes.filter(c => !c.usedAt).length, 10); assert.equal(f.state.admin!.sessionVersion, 2);
  await assert.rejects(beginRecoveryMfa(f.context, password, f.client), DomainError);
});
test("interrupted recovery start replays the same pending factor and never extends its deadline", async () => {
  const f = await recovered(), first = await beginRecoveryMfa(f.context, password, f.client), second = await beginRecoveryMfa(f.context, password, f.client);
  assert.deepEqual(second, first); assert.equal(f.state.challenges.length, 2); assert.equal(f.state.audits.length, 2);
  assert.equal(first.expiresAt, f.state.challenges[0].expiresAt.toISOString());
  assert.equal(JSON.stringify(f.state.challenges).includes(first.secret), false); assert.equal(JSON.stringify(f.state.challenges).includes(first.bindingToken), false);
});
test("normal TOTP login does not create recovery-login evidence", async () => {
  process.env.AUTH_SECRET = "test-auth-secret-not-for-real-use-0001";
  const f = await authFixture(), user = await loginAdministrator({ username: "owner", password, code: totp(secret, Math.floor(Date.now() / 30000)), recovery: false }, f.client);
  assert.equal(f.state.challenges.length, 0);
  const context = { adminId: user.id, sessionVersion: user.sessionVersion, sessionHash: tokenHash(csrfForNonce(user.csrfNonce)) };
  await assert.rejects(beginRecoveryMfa(context, password, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
});
test("wrong passwords, other sessions and expired recovery evidence cannot start binding", async () => {
  const f = await recovered();
  await assert.rejects(beginRecoveryMfa(f.context, "wrong", f.client), e => e instanceof DomainError && e.status === 401);
  await assert.rejects(beginRecoveryMfa({ ...f.context, sessionHash: tokenHash("other-browser") }, password, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  f.state.challenges[0].expiresAt = new Date(0);
  await assert.rejects(beginRecoveryMfa(f.context, password, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  assert.equal(f.state.challenges.length, 1); assert.equal(f.state.challenges[0].usedAt, null);
});
test("recovery binding tokens cannot change passwords or reset codes directly", async () => {
  const f = await recovered(), enrollment = await beginRecoveryMfa(f.context, password, f.client);
  await assert.rejects(changePassword(f.context, enrollment.bindingToken, "different-test-password", f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  await assert.rejects(resetRecoveryCodes(f.context, enrollment.bindingToken, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  assert.equal(f.state.admin!.sessionVersion, 1);
});
test("failed recovery start transaction rolls back evidence consumption and can retry", async () => {
  const f = await recovered(); f.state.failAudit = true;
  await assert.rejects(beginRecoveryMfa(f.context, password, f.client)); assert.equal(f.state.challenges.length, 1); assert.equal(f.state.challenges[0].usedAt, null);
  f.state.failAudit = false; const enrollment = await beginRecoveryMfa(f.context, password, f.client); assert.ok(enrollment.secret);
});
test("cancelled recovery binding cannot be resumed or used to generate a second factor", async () => {
  const f = await recovered(), enrollment = await beginRecoveryMfa(f.context, password, f.client);
  await cancelMfaReplacement(f.context, enrollment.bindingToken, f.client);
  await assert.rejects(beginRecoveryMfa(f.context, password, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), secret);
});
test("signout invalidates fresh recovery evidence", async () => {
  const f = await recovered(); await revokeOnSignOut(f.context.adminId, f.context.sessionVersion, f.client);
  await assert.rejects(beginRecoveryMfa(f.context, password, f.client), e => e instanceof DomainError && e.status === 401);
});

test("recovery login evidence rolls back with the consumed code if login cannot commit", async () => {
  process.env.AUTH_SECRET = "test-auth-secret-not-for-real-use-0001";
  const f = await authFixture(), recovery = await newRecoveryCodes();
  f.state.codes = [{ id: "last-recovery-code", adminId: f.state.admin!.id, codeHash: recovery.hashes[0], usedAt: null, createdAt: new Date() }]; f.state.failAudit = true;
  await assert.rejects(loginAdministrator({ username: "owner", password, code: recovery.codes[0], recovery: true }, f.client));
  assert.equal(f.state.codes[0].usedAt, null); assert.equal(f.state.challenges.length, 0);
});
test("an expired pending recovery factor cannot be retrieved by replaying its start request", async () => {
  const f = await recovered(); await beginRecoveryMfa(f.context, password, f.client);
  for (const row of f.state.challenges) row.expiresAt = new Date(0);
  await assert.rejects(beginRecoveryMfa(f.context, password, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  assert.equal(f.state.admin!.sessionVersion, 1);
});
