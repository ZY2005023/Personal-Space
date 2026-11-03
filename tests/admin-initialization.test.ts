import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeAdministrator, prepareAdministrator } from "../src/lib/admin-initialization";
import { decryptTotp, totp } from "../src/lib/crypto";
import { DomainError } from "../src/lib/domain";
import { authFixture, password } from "./helpers/auth-fixture";
test("sole-admin initialization confirms TOTP before creating any account or recovery rows", async () => {
  const f = await authFixture(true), prepared = await prepareAdministrator(" OWNER ", password), now = Date.now(), code = totp(prepared.secret, Math.floor(now / 30000));
  await assert.rejects(initializeAdministrator(prepared, "invalid", f.client, now), DomainError); assert.equal(f.state.admin, null); assert.equal(f.state.codes.length, 0);
  const result = await initializeAdministrator(prepared, code, f.client, now);
  assert.equal(result.username, "owner"); assert.equal(f.state.admin!.singletonKey, 1); assert.equal(f.state.admin!.mfaEnabled, true); assert.equal(f.state.admin!.lastTotpStep, BigInt(Math.floor(now / 30000))); assert.equal(decryptTotp(f.state.admin!.totpSecretEncrypted!), prepared.secret); assert.equal(f.state.codes.length, 10);
  await assert.rejects(initializeAdministrator(prepared, code, f.client, now), e => e instanceof DomainError && e.status === 409);
});
test("initialization rolls back account/recovery writes if the audit cannot commit", async () => {
  const f = await authFixture(true), prepared = await prepareAdministrator("owner", password); f.state.failAudit = true;
  await assert.rejects(initializeAdministrator(prepared, totp(prepared.secret, Math.floor(Date.now() / 30000)), f.client)); assert.equal(f.state.admin, null); assert.equal(f.state.codes.length, 0);
});
