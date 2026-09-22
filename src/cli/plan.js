import { readOptional } from "../validate.js";
import { loadQueue } from "../queue.js";
import { parseState, resolveStatus } from "../state.js";
import { formatLocal } from "../schedule.js";
import { join } from "node:path";
import { context, out } from "./context.js";

export const usage = "plan [--all]             upcoming posts as a calendar (--all includes published ones)";

export async function run(args) {
  const { cwd, config } = await context();
  const { posts, errors } = await loadQueue(cwd, config.postsDir);
  const state = parseState(await readOptional(join(cwd, config.stateFile)));
  const now = Date.now();
  for (const post of posts) {
    const cells = Object.keys(post.channels).map((ch) => {
      const s = resolveStatus(state, post.file, ch, post.at);
      const mark = { published: "✓", pending: post.atMs <= now ? "⏳" : "·", blocked: "⚠", given_up: "✗", skipped: "↷" }[s.status];
      return `${mark} ${ch}${config.channels.includes(ch) || s.status === "published" ? "" : " (off)"}`;
    });
    const done = Object.keys(post.channels).every((ch) => resolveStatus(state, post.file, ch, post.at).status === "published");
    if (done && !args.values.all) continue;
    out(`${formatLocal(post.atMs, config.timezone)}  ${cells.join("  ")}  ${post.file}`);
  }
  for (const e of errors) out(`✗ ${e.file}: ${e.error}`);
}
