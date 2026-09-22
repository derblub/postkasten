import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * `postkasten.config.json` in the content repo, with defaults. Credentials
 * never live here; they come from the environment (see `credentials`).
 */
export const DEFAULT_CONFIG = {
  timezone: "Europe/Vienna",
  dueWindowHours: 12,
  linkedinVersion: "202609",
  bskyService: "https://bsky.social",
  branch: "main",
  postsDir: "posts",
  stateFile: "state/published.jsonl",
  rulesFile: "rules/forbidden.txt",
  profileFile: "profile/bluesky.md",
  gitUser: { name: "postkasten", email: "postkasten@localhost" },
};

export async function loadConfig(cwd) {
  let overrides = {};
  try {
    overrides = JSON.parse(await readFile(join(cwd, "postkasten.config.json"), "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`postkasten.config.json: ${err.message}`);
  }
  const config = { ...DEFAULT_CONFIG, ...overrides, gitUser: { ...DEFAULT_CONFIG.gitUser, ...overrides.gitUser } };
  if (!/^\d{6}$/.test(String(config.linkedinVersion))) {
    throw new Error(`linkedinVersion must be YYYYMM, got ${config.linkedinVersion}`);
  }
  return config;
}

/** Reads credentials from the environment; missing ones are `undefined`. */
export function credentials(env = process.env) {
  return {
    linkedin: {
      token: env.LINKEDIN_ACCESS_TOKEN,
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      version: env.LINKEDIN_VERSION,
    },
    bluesky: {
      handle: env.BLUESKY_HANDLE,
      appPassword: env.BLUESKY_APP_PASSWORD,
    },
    ntfyTopic: env.NTFY_TOPIC,
    ntfyServer: env.NTFY_SERVER || "https://ntfy.sh",
  };
}
