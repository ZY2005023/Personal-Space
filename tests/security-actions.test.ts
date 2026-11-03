import { test } from "node:test";
import assert from "node:assert/strict";
import { beginMfaReplacement, cancelMfaReplacement, changePassword, confirmMfaReplacement, reauthenticate, resetRecoveryCodes, revokeOnSignOut, revokeSessions } from "../src/lib/security-store";
import { decryptTotp, totp } from "../src/lib/crypto";
import { tokenHash, verifyHash, type Operation } from "../src/lib/auth-policy";
import { DomainError } from "../src/lib/domain";
import { authFixture, context, password, secret } from "./helpers/auth-fixture";
async function grant(f: Awaited<ReturnType<typeof authFixture>>, operation: Operation) {
  const body = { password, code: totp(secret, Math.floor(Date.now() / 30000)), recovery: false, operation };
  return reauthenticate(context, body, operation, f.client);
}
test("reauthentication stores only a hashed, session-bound operation proof", async () => {
  const f = await authFixture(), proof = await grant(f, "PASSWORD_CHANGE"), row = f.state.challenges[0];
  assert.equal(row.tokenHash, tokenHash(proof.token)); assert.equal(row.operation, "PASSWORD_CHANGE"); assert.equal(row.sessionHash, context.sessionHash); assert.equal(row.sessionVersion, 1); assert.ok(row.expiresAt.getTime() - Date.now() <= 300000);
  assert.doesNotMatch(JSON.stringify({ challenges: f.state.challenges, audit: f.state.audits }), new RegExp(proof.token + "|" + password));
});
test("proofs cannot cross sessions, operations or expiry boundaries", async () => {
  const f = await authFixture(), proof = await grant(f, "PASSWORD_CHANGE");
  const original = f.state.admin!.passwordHash;
  await assert.rejects(changePassword({ ...context, sessionHash: tokenHash("other-session") }, proof.token, "new-test-only-password", f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  await assert.rejects(revokeSessions(context, proof.token, f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  f.state.challenges[0].expiresAt = new Date(0);
  await assert.rejects(changePassword(context, proof.token, "new-test-only-password", f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  assert.equal(f.state.admin!.passwordHash, original); assert.equal(f.state.challenges[0].usedAt, null);
});
test("password changes consume their proof once, revoke sessions and preserve atomic rollback", async () => {
  const f = await authFixture(), proof = await grant(f, "PASSWORD_CHANGE"), original = f.state.admin!.passwordHash;
  f.state.failAudit = true; await assert.rejects(changePassword(context, proof.token, "new-test-only-password", f.client));
  assert.equal(f.state.admin!.passwordHash, original); assert.equal(f.state.admin!.sessionVersion, 1); assert.equal(f.state.challenges[0].usedAt, null);
  f.state.failAudit = false; await changePassword(context, proof.token, "new-test-only-password", f.client);
  assert.equal(await verifyHash(f.state.admin!.passwordHash, "new-test-only-password"), true); assert.equal(f.state.admin!.sessionVersion, 2); assert.ok(f.state.challenges[0].usedAt);
  await assert.rejects(changePassword({ ...context, sessionVersion: 2 }, proof.token, "another-test-password", f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
});
test("resetting recovery codes returns plaintext once and stores only replacement hashes", async () => {
  const f = await authFixture(), proof = await grant(f, "RECOVERY_RESET");
  const result = await resetRecoveryCodes(context, proof.token, f.client);
  assert.equal(result.recoveryCodes.length, 10); assert.equal(f.state.codes.length, 10); assert.equal(f.state.admin!.sessionVersion, 2);
  assert.equal(await verifyHash(f.state.codes[0].codeHash, result.recoveryCodes[0]), true);
  assert.equal(result.recoveryCodes.some(c => JSON.stringify({ codes: f.state.codes, audit: f.state.audits }).includes(c)), false);
});
test("MFA starts without changing the active factor, rejects wrong confirmation and then replaces atomically", async () => {
  const f = await authFixture(), proof = await grant(f, "MFA_REPLACE"), enrollment = await beginMfaReplacement(context, proof.token, f.client);
  assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), secret); assert.equal(f.state.admin!.sessionVersion, 1);
  const pending = f.state.challenges.find(c => c.purpose === "MFA_BINDING")!; assert.ok(pending.encryptedPayload); assert.equal(pending.encryptedPayload.includes(enrollment.secret), false);
  const now = Date.now(), correct = totp(enrollment.secret, Math.floor(now / 30000)), incorrect = String((Number(correct) + 17) % 1000000).padStart(6, "0");
  await assert.rejects(confirmMfaReplacement(context, enrollment.bindingToken, incorrect, f.client, now), DomainError);
  assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), secret);
  const result = await confirmMfaReplacement(context, enrollment.bindingToken, correct, f.client, now);
  assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), enrollment.secret); assert.equal(f.state.admin!.sessionVersion, 2); assert.equal(result.recoveryCodes.length, 10); assert.equal(f.state.codes.length, 10);
  assert.equal(f.state.challenges.find(c => c.purpose === "MFA_BINDING")!.encryptedPayload, null);
  await assert.rejects(confirmMfaReplacement({ ...context, sessionVersion: 2 }, enrollment.bindingToken, correct, f.client, now), DomainError);
});
test("MFA enrollment cannot cross browser sessions and a revoked session cannot apply a proof", async () => {
  const f = await authFixture(), proof = await grant(f, "MFA_REPLACE"), enrollment = await beginMfaReplacement(context, proof.token, f.client);
  await assert.rejects(confirmMfaReplacement({ ...context, sessionHash: tokenHash("other") }, enrollment.bindingToken, totp(enrollment.secret, Math.floor(Date.now() / 30000)), f.client), e => e instanceof DomainError && e.code === "REAUTH_REQUIRED");
  f.state.admin!.sessionVersion++;
  await assert.rejects(revokeSessions(context, proof.token, f.client), e => e instanceof DomainError && e.status === 401);
});
test("signout increments only its current session version and cannot revoke newer signins with a stale token", async () => {
  const f = await authFixture(); await revokeOnSignOut(context.adminId, 1, f.client); assert.equal(f.state.admin!.sessionVersion, 2); assert.equal(f.state.audits.length, 1);
  await revokeOnSignOut(context.adminId, 1, f.client); assert.equal(f.state.admin!.sessionVersion, 2); assert.equal(f.state.audits.length, 1);
});

test("cancelling an MFA replacement invalidates the pending factor without changing the active one", async () => {
  const f = await authFixture(), proof = await grant(f, "MFA_REPLACE"), enrollment = await beginMfaReplacement(context, proof.token, f.client);
  await cancelMfaReplacement(context, enrollment.bindingToken, f.client);
  assert.equal(f.state.challenges.find(c => c.purpose === "MFA_BINDING")!.encryptedPayload, null);
  assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), secret); assert.equal(f.state.admin!.sessionVersion, 1);
  await assert.rejects(confirmMfaReplacement(context, enrollment.bindingToken, totp(enrollment.secret, Math.floor(Date.now() / 30000)), f.client), DomainError);
});
