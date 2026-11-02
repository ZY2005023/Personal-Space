import assert from "node:assert/strict";
const base = process.env.SMOKE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "Only use the local unconfigured test instance");
const login = await fetch(base + "/login");
assert.match(await login.text(), /空间尚未初始化/, "This check is for an unconfigured instance, not a real admin account");
const providers = await (await fetch(base + "/api/auth/providers")).json();
assert.equal(providers.credentials.type, "credentials");
const csrf = await fetch(base + "/api/auth/csrf"); assert.equal(csrf.status, 200);
const { csrfToken } = await csrf.json(); assert.ok(csrfToken);
const cookies = csrf.headers.getSetCookie().map(c => c.split(";", 1)[0]).join("; ");
assert.ok(cookies.includes("csrf-token="));
const callback = await fetch(base + "/api/auth/callback/credentials", {
  method: "POST", redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies, Origin: base },
  body: new URLSearchParams({ csrfToken, username: "test-no-real-account", password: "test-not-a-real-password", code: "000000", recovery: "false", callbackUrl: base + "/admin", json: "true" }),
});
assert.ok(callback.status < 500, "Provider route must work with async params, cookies and headers");
const result = await callback.json(); assert.match(result.url, /error=CredentialsSignin/);
assert.equal(callback.headers.getSetCookie().some(c => /session-token=.+/.test(c)), false);
const session = await (await fetch(base + "/api/auth/session", { headers: { Cookie: cookies } })).json();
assert.equal(session?.user, undefined);
const admin = await fetch(base + "/api/v1/admin/contents", { headers: { Cookie: cookies } }); assert.equal(admin.status, 401);
console.log("Auth.js stable compatibility passed: provider discovery, CSRF cookie, async credentials callback rejection, no session cookie, anonymous session, protected API denial. No account or database was created.");
