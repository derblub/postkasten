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
  channels: ["linkedin", "bluesky"],
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
  if (!Array.isArray(config.channels) || config.channels.some((c) => !["linkedin", "bluesky"].includes(c))) {
    throw new Error(`channels must be a list of "linkedin" and/or "bluesky", got ${JSON.stringify(config.channels)}`);
  }
  if (!/^\d{6}$/.test(String(config.linkedinVersion))) {
    throw new Error(`linkedinVersion must be YYYYMM, got ${config.linkedinVersion}`);
  }
  return config;
}

/** Reads credentials from the environment; missing or empty ones are `undefined`. */
export function credentials(env = process.env) {
  const v = (k) => env[k]?.trim() || undefined;
  return {
    linkedin: {
      token: v("LINKEDIN_ACCESS_TOKEN"),
      clientId: v("LINKEDIN_CLIENT_ID"),
      clientSecret: v("LINKEDIN_CLIENT_SECRET"),
      version: v("LINKEDIN_VERSION"),
    },
    bluesky: {
      handle: v("BLUESKY_HANDLE"),
      appPassword: v("BLUESKY_APP_PASSWORD"),
    },
    ntfyTopic: v("NTFY_TOPIC"),
    ntfyServer: v("NTFY_SERVER") ?? "https://ntfy.sh",
  };
}

/**
 * The LinkedIn-Version header to send: LINKEDIN_VERSION or the config value.
 * Checked here, where it is used, so a malformed variable only breaks LinkedIn.
 */
export function linkedinVersion(creds, config) {
  const version = creds.linkedin.version;
  if (version === undefined) return config.linkedinVersion;
  if (!/^\d{6}$/.test(version)) throw new Error(`LINKEDIN_VERSION must be YYYYMM, got ${version}`);
  return version;
}
