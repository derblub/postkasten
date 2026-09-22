#!/usr/bin/env node
import { parseArgs } from "node:util";
import { redact } from "../src/git.js";

const COMMANDS = {
  validate: () => import("../src/cli/validate.js"),
  plan: () => import("../src/cli/plan.js"),
  publish: () => import("../src/cli/publish.js"),
  doctor: () => import("../src/cli/doctor.js"),
  resolve: () => import("../src/cli/resolve.js"),
  linkedin: () => import("../src/cli/linkedin.js"),
  bluesky: () => import("../src/cli/bluesky.js"),
};

const args = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean" },
    offline: { type: "boolean" },
    all: { type: "boolean" },
    drop: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    now: { type: "string" },
    text: { type: "string" },
    file: { type: "string" },
    published: { type: "string" },
    redirect: { type: "string" },
  },
});

const name = args.positionals[0];
if (!name || args.values.help || !COMMANDS[name]) {
  const mods = await Promise.all(Object.values(COMMANDS).map((load) => load()));
  process.stdout.write(`postkasten: scheduled social posts from a git repo\n\nUsage:\n  ${mods.map((m) => m.usage).join("\n  ")}\n\nCredentials come from the environment: LINKEDIN_ACCESS_TOKEN, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,\nBLUESKY_HANDLE, BLUESKY_APP_PASSWORD, NTFY_TOPIC. Configuration: postkasten.config.json.\n`);
  process.exit(name && !COMMANDS[name] ? 1 : 0);
}

try {
  const mod = await COMMANDS[name]();
  await mod.run(args);
} catch (err) {
  process.stderr.write(`${redact(err.message)}\n`);
  process.exit(1);
}
