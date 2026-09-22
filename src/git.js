import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The few git operations the publisher needs. Everything runs in `cwd`; the
 * caller decides whether a failure is fatal. Output is never logged in full,
 * remotes may carry a token in their URL.
 */
export function createGit({ cwd, branch = "main", user, log = () => {} }) {
  async function git(...args) {
    try {
      const { stdout } = await run("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
      return stdout.trim();
    } catch (err) {
      const detail = (err.stderr || err.message || "").toString().split("\n").slice(-3).join(" ").trim();
      throw new Error(`git ${args[0]} failed: ${redact(detail)}`);
    }
  }

  return {
    /** Detached CI checkouts become a real branch; then sync and prove we may push. */
    async preflight() {
      if (user?.email) await git("config", "user.email", user.email);
      if (user?.name) await git("config", "user.name", user.name);
      await git("fetch", "origin", branch);
      await git("checkout", "-B", branch, `origin/${branch}`);
      await git("push", "--dry-run", "origin", `HEAD:${branch}`);
      log("git preflight ok");
    },
    async commitAndPush(paths, message) {
      await git("add", "--", ...paths);
      const status = await git("status", "--porcelain", "--", ...paths);
      if (!status) return false;
      await git("commit", "-q", "-m", message);
      try {
        await git("push", "-q", "-o", "ci.skip", "origin", `HEAD:${branch}`);
      } catch (first) {
        log(`push rejected, rebasing once: ${first.message}`);
        await git("pull", "-q", "--rebase", "origin", branch);
        await git("push", "-q", "-o", "ci.skip", "origin", `HEAD:${branch}`);
      }
      return true;
    },
    async isClean(paths) {
      return (await git("status", "--porcelain", "--", ...paths)) === "";
    },
  };
}

export function redact(text) {
  return String(text).replace(/(https?:\/\/)[^\s/@]+@/g, "$1***@");
}

/** A git double that records calls and never touches a repository (dry runs, tests). */
export function createNullGit(log = () => {}) {
  const calls = [];
  return {
    calls,
    async preflight() { calls.push(["preflight"]); log("git preflight skipped (dry run)"); },
    async commitAndPush(paths, message) { calls.push(["commitAndPush", paths, message]); return true; },
    async isClean() { return true; },
  };
}
