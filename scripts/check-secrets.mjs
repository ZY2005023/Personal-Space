import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

function forbiddenPath(path) {
  return /(?:^|\/)\.env(?:\.[^/]+)?$/.test(path) && !/(?:^|\/)\.env(?:\.\w+)?\.example$/.test(path)
    || /(?:^|\/)(?:node_modules|\.next|\.secrets|work|backups|uploads|media-originals|storage|data)(?:\/|$)/.test(path)
    || /\.(?:pem|key|p12|pfx|dump|sqlite3?|db)$/i.test(path);
}
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["github-token", /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/],
  ["provider-api-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["credential-in-url", /https?:\/\/[^\s/:@]+:[^\s/@]+@/],
];
function inspect(path, data) {
  if (forbiddenPath(path)) return ["private-or-generated-path"];
  if (data.subarray(0, 8192).includes(0)) return [];
  const text = data.toString("utf8");
  return rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
if (process.argv.includes("--self-test")) {
  assert.deepEqual(inspect(".env.local", Buffer.from("")), ["private-or-generated-path"]);
  assert.deepEqual(inspect(".env.example", Buffer.from("AUTH_SECRET=\n")), []);
  assert.deepEqual(inspect(".env.production.example", Buffer.from("DATABASE_URL=\n")), []);
  assert.deepEqual(inspect("src/example.ts", Buffer.from("const token = '" + "ghp_" + "A".repeat(36) + "'")), ["github-token"]);
  assert.deepEqual(inspect("docs/key.txt", Buffer.from("-----BEGIN " + "PRIVATE KEY-----")), ["private-key"]);
  assert.deepEqual(inspect("src/test.ts", Buffer.from("const password = 'test-not-a-real-password'")), []);
  console.log("Staged-content checks: self-test passed.");
} else {
  const git = args => execFileSync("git", args, { encoding: null, maxBuffer: 32 * 1024 * 1024 });
  const paths = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).toString("utf8").split("\0").filter(Boolean);
  const errors = [];
  for (const path of paths) {
    const matches = inspect(path, git(["show", ":" + path]));
    if (matches.length) errors.push(`${path}: ${matches.join(", ")}`);
  }
  if (errors.length) { console.error("Commit blocked. Review these files (values omitted):\n" + errors.join("\n")); process.exitCode = 1; }
  else console.log(`Staged-content checks passed (${paths.length} files).`);
}
