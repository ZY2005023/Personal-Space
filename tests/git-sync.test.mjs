import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { syncGit } from "../scripts/sync-git.mjs";

const scratch = resolve("work/git-sync-tests"); mkdirSync(scratch, { recursive: true });
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture() {
  const root = mkdtempSync(join(scratch, "case-")), remote = join(root, "remote.git"), cwd = join(root, "project");
  mkdirSync(cwd); git(root, ["init", "--bare", "--initial-branch=main", remote]); git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.name", "Sync Test"]); git(cwd, ["config", "user.email", "test@example.invalid"]);
  mkdirSync(join(cwd, "scripts")); copyFileSync("scripts/check-secrets.mjs", join(cwd, "scripts/check-secrets.mjs")); copyFileSync(".gitignore", join(cwd, ".gitignore"));
  writeFileSync(join(cwd, "README.md"), "test fixture\n"); git(cwd, ["add", "--all"]); git(cwd, ["commit", "-m", "fixture"]); git(cwd, ["remote", "add", "origin", remote]); git(cwd, ["push", "-u", "origin", "main"]);
  return { cwd, remote, root, sync: () => syncGit({ cwd, expectedRemote: remote }), head: () => git(cwd, ["rev-parse", "HEAD"]) };
}
test("no changes and no pending commits create no commit and no push", () => {
  const f = fixture(), before = f.head(); const result = f.sync(); assert.equal(result.unchanged, true); assert.equal(result.pushed, false); assert.equal(f.head(), before);
});
test("changed source is committed and pushed while environment files stay untracked", () => {
  const f = fixture(); writeFileSync(join(f.cwd, "feature.txt"), "new source\n"); writeFileSync(join(f.cwd, ".env.local"), "AUTH_SECRET=not-a-real-secret\n");
  const result = f.sync(); assert.equal(result.committed, true); assert.equal(result.pushed, true); assert.equal(git(f.root, ["--git-dir=" + f.remote, "rev-parse", "refs/heads/main"]), f.head()); assert.equal(git(f.cwd, ["ls-files", ".env.local"]), "");
});
test("an existing local commit is pushed without manufacturing another commit", () => {
  const f = fixture(); writeFileSync(join(f.cwd, "feature.txt"), "new source\n"); git(f.cwd, ["add", "feature.txt"]); git(f.cwd, ["commit", "-m", "actual implementation"]); const before = f.head();
  const result = f.sync(); assert.equal(result.committed, false); assert.equal(result.pushed, true); assert.equal(f.head(), before);
});
test("remote updates stop synchronization without rewriting or discarding local edits", () => {
  const f = fixture(), other = join(f.root, "other"); git(f.root, ["clone", f.remote, other]); git(other, ["config", "user.name", "Other Test"]); git(other, ["config", "user.email", "other@example.invalid"]); writeFileSync(join(other, "remote.txt"), "remote change\n"); git(other, ["add", "--all"]); git(other, ["commit", "-m", "remote change"]); git(other, ["push"]);
  writeFileSync(join(f.cwd, "local.txt"), "preserve this\n"); const before = f.head(); assert.throws(f.sync, /Remote main contains unmerged/); assert.equal(f.head(), before); assert.equal(readFileSync(join(f.cwd, "local.txt"), "utf8"), "preserve this\n");
});
test("wrong repository, push URL or branch is rejected before upload", () => {
  const f = fixture(); assert.throws(() => syncGit({ cwd: f.cwd, expectedRemote: "https://github.com/example/wrong.git" }), /authorized/);
  git(f.cwd, ["remote", "set-url", "--push", "origin", join(f.root, "wrong.git")]); assert.throws(f.sync, /Push URL/); git(f.cwd, ["remote", "set-url", "--push", "origin", f.remote]);
  git(f.cwd, ["checkout", "-b", "feature"]); assert.throws(f.sync, /not main/); assert.equal(git(f.cwd, ["branch", "--show-current"]), "feature");
});
test("force-staged environment files block the commit and push", () => {
  const f = fixture(), before = f.head(); writeFileSync(join(f.cwd, ".env.local"), "test fixture only\n"); git(f.cwd, ["add", "--force", ".env.local"]); assert.throws(f.sync); assert.equal(f.head(), before); assert.equal(git(f.root, ["--git-dir=" + f.remote, "rev-parse", "refs/heads/main"]), before);
});
