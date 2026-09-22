import { publish } from "../publish.js";
import { createGit, createNullGit } from "../git.js";
import { createRecordingFetch } from "../dryrun.js";
import { context, log, out } from "./context.js";

export const usage = "publish [--dry-run] [--now ISO]   post everything that is due";

export async function run(args) {
  const { cwd, config, creds, notify } = await context();
  const dryRun = Boolean(args.values["dry-run"]);
  const nowMs = args.values.now ? Date.parse(args.values.now) : Date.now();
  if (Number.isNaN(nowMs)) throw new Error(`--now is not a date: ${args.values.now}`);

  const recorder = dryRun ? createRecordingFetch() : null;
  const summary = await publish({
    cwd,
    config,
    creds: dryRun ? withDryCreds(creds) : creds,
    nowMs,
    git: dryRun ? createNullGit(log) : createGit({ cwd, branch: config.branch, user: config.gitUser, log }),
    notify: dryRun ? async (n) => log(`[dry run] ntfy: ${n.title}`) : notify,
    fetch: dryRun ? recorder.fetch : globalThis.fetch,
    fetchResource: globalThis.fetch,
    dryRun,
    log,
  });
  if (dryRun) out(JSON.stringify({ summary, requests: recorder.requests }, null, 2));
  else log(`published ${summary.published.length}, failed ${summary.failed.length}, skipped ${summary.skipped.length}, blocked ${summary.blocked.length}, waiting for a disabled channel ${summary.disabled.length}`);
  process.exitCode = summary.failed.length || summary.blocked.length ? 1 : 0;
}

function withDryCreds(creds) {
  return {
    ...creds,
    linkedin: { ...creds.linkedin, token: creds.linkedin.token ?? "dry-run" },
    bluesky: { handle: creds.bluesky.handle ?? "dryrun.invalid", appPassword: creds.bluesky.appPassword ?? "dry-run" },
  };
}
