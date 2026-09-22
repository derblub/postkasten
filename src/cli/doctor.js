import { join } from "node:path";
import { introspectToken } from "../linkedin/client.js";
import { createBluesky } from "../bluesky/client.js";
import { parseState, openIntents } from "../state.js";
import { readOptional } from "../validate.js";
import { context, log, out } from "./context.js";

export const usage = "doctor                   check credentials, LinkedIn token expiry, API version age, open intents";

const WARN_DAYS = [14, 7, 3, 1];

export async function run() {
  const { cwd, config, creds, notify } = await context();
  const findings = [];
  const problems = [];

  // LinkedIn token
  if (!creds.linkedin.token) problems.push("LINKEDIN_ACCESS_TOKEN is not set");
  else if (!creds.linkedin.clientId || !creds.linkedin.clientSecret) findings.push("LinkedIn token set; expiry unknown without LINKEDIN_CLIENT_ID/SECRET");
  else {
    try {
      const info = await introspectToken({ clientId: creds.linkedin.clientId, clientSecret: creds.linkedin.clientSecret, token: creds.linkedin.token });
      if (!info.active) problems.push("LinkedIn token is no longer active. Run: postkasten linkedin auth");
      else {
        const days = (info.expires_at * 1000 - Date.now()) / 86_400_000;
        const when = new Date(info.expires_at * 1000).toISOString().slice(0, 10);
        findings.push(`LinkedIn token valid until ${when} (${days.toFixed(1)} days)`);
        const threshold = WARN_DAYS.find((d) => days <= d);
        if (threshold !== undefined) {
          await notify({
            title: `LinkedIn token expires in ${Math.max(0, Math.ceil(days))} day(s)`,
            priority: threshold <= 3 ? "urgent" : "high",
            tags: ["key"],
            message: `Valid until ${when}. Renew: postkasten linkedin auth, then update LINKEDIN_ACCESS_TOKEN in CI.`,
          });
        }
      }
    } catch (err) {
      problems.push(`LinkedIn introspection failed: ${err.message}`);
    }
  }

  // LinkedIn API version age
  const v = String(creds.linkedin.version ?? config.linkedinVersion);
  const ageMonths = (new Date().getUTCFullYear() - Number(v.slice(0, 4))) * 12 + (new Date().getUTCMonth() + 1 - Number(v.slice(4)));
  if (ageMonths >= 10) problems.push(`LinkedIn-Version ${v} is ${ageMonths} months old; versions are sunset after about a year. Bump linkedinVersion.`);
  else findings.push(`LinkedIn-Version ${v} (${ageMonths} months old)`);

  // Bluesky
  try {
    const bsky = createBluesky({ service: config.bskyService });
    const { handle } = await bsky.login(creds.bluesky.handle, creds.bluesky.appPassword);
    findings.push(`Bluesky login ok as ${handle}`);
  } catch (err) {
    problems.push(`Bluesky: ${err.message}`);
  }

  // Open intents
  const intents = openIntents(parseState(await readOptional(join(cwd, config.stateFile))));
  for (const i of intents) problems.push(`open intent: ${i.file} ${i.channel} since ${i.ts}`);

  if (!creds.ntfyTopic) findings.push("NTFY_TOPIC not set: no notifications");

  for (const f of findings) out(`✓ ${f}`);
  for (const p of problems) out(`✗ ${p}`);
  if (problems.length) {
    await notify({ title: "postkasten doctor", priority: "high", tags: ["stethoscope"], message: problems.join("\n") });
    process.exitCode = 1;
  } else log("all good");
}
