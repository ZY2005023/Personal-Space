import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedRepository = "https://github.com/ZY2005023/Personal-Space.git";
export function syncGit({ cwd = defaultRoot, expectedRemote = expectedRepository, dryRun = false } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  const git = args => execFileSync("git", ["-c", "credential.interactive=false", ...args], { cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const remote = git(["remote", "get-url", "origin"]);
  if (remote !== expectedRemote) throw new Error("origin is not the authorized Personal Space repository; stopped.");
  if (git(["remote", "get-url", "--push", "origin"]) !== expectedRemote) throw new Error("Push URL differs from the authorized repository; stopped.");
  if (git(["branch", "--show-current"]) !== "main") throw new Error("Current branch is not main; no branch was switched.");
  for (const state of ["MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"]) {
    if (existsSync(resolve(cwd, git(["rev-parse", "--git-path", state])))) throw new Error("A Git operation is in progress; resolve it before synchronization.");
  }
  if (git(["diff", "--name-only", "--diff-filter=U"])) throw new Error("Unresolved conflicts; stopped.");
  const localChanges = Boolean(git(["status", "--porcelain"]));
  if (dryRun) return { dryRun: true, branch: "main", localChanges, committed: false, pushed: false };
  git(["fetch", "origin", "main"]);
  const [ahead, behind] = git(["rev-list", "--left-right", "--count", "HEAD...origin/main"]).split(/\s+/).map(Number);
  if (behind > 0) throw new Error("Remote main contains unmerged updates; no pull, rebase or force-push was attempted.");
  let committed = false;
  if (localChanges) {
    git(["add", "--all"]);
    execFileSync(process.execPath, [resolve(cwd, "scripts/check-secrets.mjs")], { cwd, env, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    const changes = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd, env });
    if (changes.status === 1) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value]));
      git(["commit", "-m", `chore: daily sync ${parts.year}-${parts.month}-${parts.day}`]); committed = true;
    } else if (changes.status !== 0) throw new Error("Could not inspect staged changes; stopped.");
  }
  const unpushed = committed || ahead > 0;
  if (unpushed) git(["push", "origin", "main"]);
  return { branch: "main", committed, pushed: unpushed, unchanged: !committed && !unpushed, commit: git(["rev-parse", "HEAD"]) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = syncGit({ dryRun: process.argv.includes("--dry-run") });
    // A no-change run is intentionally quiet, without creating an empty commit.
    if (!result.unchanged) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Do not echo credential-helper stderr, HTTP URLs containing credentials, or secret scanner values.
    console.error("Git synchronization stopped:", error instanceof Error && !error.stderr ? error.message : "Git/network/authentication or staged-content check failed; review locally.");
    process.exitCode = 1;
  }
}
