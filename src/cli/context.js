import { loadConfig, credentials } from "../config.js";
import { createNotifier } from "../notify.js";

export const log = (msg) => process.stderr.write(`${msg}\n`);
export const out = (msg) => process.stdout.write(`${msg}\n`);

export async function context(cwd = process.cwd(), env = process.env) {
  const config = await loadConfig(cwd);
  const creds = credentials(env);
  const notify = createNotifier({ topic: creds.ntfyTopic, server: creds.ntfyServer, log });
  return { cwd, config, creds, notify };
}

export function fail(message, code = 1) {
  log(message);
  process.exit(code);
}
