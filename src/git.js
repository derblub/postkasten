import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const PUSH_OPTIONS = ["-o", "ci.skip"];

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
    /** Detached CI checkouts become a real branch; then sync and prove we may push (with the same push options). */
    async preflight() {
      if (user?.email) await git("config", "user.email", user.email);
      if (user?.name) await git("config", "user.name", user.name);
      await git("fetch", "origin", branch);
      await git("checkout", "-B", branch, `origin/${branch}`);
      await git("push", "--dry-run", ...PUSH_OPTIONS, "origin", `HEAD:${branch}`);
      log("git preflight ok");
    },
    /**
     * Commits `paths` and pushes. A rejected push is retried once on top of
     * origin. With `reapply`, our commit is dropped, the branch moved to
     * origin/<branch> and `reapply` writes the change again on that tree; it
     * sees what others pushed and may throw to refuse. Without it, the commit
     * is rebased and a conflict throws. The repository is never left mid-rebase.
     * @param {string[]} paths
     * @param {string} message
     * @param {() => Promise<void>} [reapply]  re-does the change on a fresh tree
     */
    async commitAndPush(paths, message, reapply) {
      await git("add", "--", ...paths);
      const status = await git("status", "--porcelain", "--", ...paths);
      if (!status) return false;
      await git("commit", "-q", "-m", message);
      try {
        await git("push", "-q", ...PUSH_OPTIONS, "origin", `HEAD:${branch}`);
      } catch (first) {
        log(`push rejected, retrying on top of origin/${branch}: ${first.message}`);
        await git("fetch", "origin", branch);
        if (reapply) {
          await git("reset", "-q", "--keep", `origin/${branch}`);
          await reapply();
          await git("add", "--", ...paths);
          await git("commit", "-q", "-m", message);
        } else {
          try {
            await git("rebase", "-q", `origin/${branch}`);
          } catch (err) {
            await git("rebase", "--abort").catch(() => {});
            throw err;
          }
        }
        await git("push", "-q", ...PUSH_OPTIONS, "origin", `HEAD:${branch}`);
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
