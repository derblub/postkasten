import { validate } from "../validate.js";
import { context, log, out } from "./context.js";

export const usage = "validate [--offline]     check every post file (schema, lengths, rules, links, images)";

export async function run(args) {
  const { cwd, config } = await context();
  const { ok, problems, posts } = await validate({ cwd, config, online: !args.values.offline });
  for (const p of problems) out(`${p.level === "error" ? "✗" : "!"} ${p.file}: ${p.message}`);
  const errors = problems.filter((p) => p.level === "error").length;
  const warnings = problems.length - errors;
  log(`${posts.length} post(s), ${errors} error(s), ${warnings} warning(s)`);
  process.exitCode = ok ? 0 : 1;
}
