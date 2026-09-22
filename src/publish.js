import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createLinkedIn, postUrl as linkedinUrl } from "./linkedin/client.js";
import { buildPost } from "./linkedin/posts.js";
import { createBluesky, postUrl as blueskyUrl } from "./bluesky/client.js";
import { buildRecord, isDuplicate } from "./bluesky/embed.js";
import { fetchImage, fetchOg } from "./og.js";
import { parseState, resolveStatus, serializeEntry, MAX_FAILURES } from "./state.js";
import { formatLocal, isDue, overdueHours } from "./schedule.js";
import { validate, readOptional } from "./validate.js";

/**
 * Publishes every due post. See docs/ci.md for the guarantees:
 * git preflight before anything is posted, an `intent` line pushed before each
 * attempt, a `published` line pushed right after, one failure never blocks the
 * other candidates.
 *
 * @param {object} o
 * @param {string} o.cwd
 * @param {object} o.config
 * @param {ReturnType<import('./config.js').credentials>} o.creds
 * @param {number} o.nowMs
 * @param {object} o.git            createGit() or createNullGit()
 * @param {Function} o.notify       createNotifier()
 * @param {Function} o.fetch        fetch for the platform APIs (fake in dry runs)
 * @param {Function} o.fetchResource fetch for OG pages and images (always real)
 * @param {boolean} o.dryRun
 * @param {Function} o.log
 */
export async function publish({ cwd, config, creds, nowMs, git, notify, fetch: apiFetch, fetchResource, dryRun = false, log = () => {}, visibility = "PUBLIC" }) {
  const summary = { published: [], failed: [], skipped: [], blocked: [], givenUp: [], invalid: [], candidates: 0 };
  const statePath = join(cwd, config.stateFile);
  const now = new Date(nowMs).toISOString();

  const { problems, posts } = await validate({ cwd, config, online: false });
  const invalidFiles = new Set(problems.filter((p) => p.level === "error").map((p) => p.file));
  for (const file of invalidFiles) {
    summary.invalid.push(file);
    log(`skipping ${file}: ${problems.filter((p) => p.file === file && p.level === "error").map((p) => p.message).join("; ")}`);
  }

  const state = parseState(await readOptional(statePath));
  const candidates = [];
  for (const post of posts) {
    if (invalidFiles.has(post.file) || !isDue(post.atMs, nowMs)) continue;
    for (const channel of Object.keys(post.channels)) {
      const status = resolveStatus(state, post.file, channel, post.at);
      if (status.status === "published" || status.status === "skipped") continue;
      if (status.status === "blocked") {
        summary.blocked.push({ file: post.file, channel });
        log(`blocked: ${post.file} ${channel} has an open intent from ${status.entry.ts}`);
        continue;
      }
      if (status.status === "given_up") {
        summary.givenUp.push({ file: post.file, channel });
        continue;
      }
      candidates.push({ post, channel, failures: status.failures });
    }
  }
  summary.candidates = candidates.length;

  if (summary.blocked.length) {
    await notify({
      title: "postkasten: open intent",
      priority: "high",
      tags: ["warning"],
      message: summary.blocked.map((b) => `${b.file} (${b.channel}) has an intent without a result. Check the platform and run: postkasten resolve ${b.file} ${b.channel} --published <id> | --drop`).join("\n"),
    });
  }
  if (!candidates.length) {
    log("nothing due");
    return summary;
  }

  try {
    await git.preflight();
  } catch (err) {
    log(err.message);
    await notify({ title: "postkasten: git preflight failed", priority: "high", tags: ["rotating_light"], message: err.message });
    throw err;
  }

  const record = async (entry) => {
    const line = { ...entry, ts: new Date().toISOString() };
    state.push(line);
    if (dryRun) {
      log(`[dry run] state += ${JSON.stringify(line)}`);
      return;
    }
    await appendFile(statePath, serializeEntry(line));
    await git.commitAndPush([config.stateFile], `${entry.status}: ${entry.channel} ${entry.file}`);
  };

  let linkedin = null;
  let bluesky = null;

  for (const { post, channel, failures } of candidates) {
    const cp = post.channels[channel];
    const label = `${post.file} (${channel}, ${formatLocal(post.atMs, config.timezone)})`;

    const hours = overdueHours(post.atMs, nowMs);
    if (hours > config.dueWindowHours) {
      await record({ file: post.file, channel, status: "skipped", at: post.at, reason: `overdue ${hours.toFixed(1)}h` });
      summary.skipped.push({ file: post.file, channel });
      log(`skipped ${label}: overdue ${hours.toFixed(1)} h`);
      await notify({ title: "postkasten: post skipped", priority: "default", tags: ["hourglass"], message: `${label} was ${hours.toFixed(1)} h overdue and was not posted. Re-date it to post it.` });
      continue;
    }

    try {
      await record({ file: post.file, channel, status: "intent", at: post.at });
    } catch (err) {
      log(`cannot write intent, stopping: ${err.message}`);
      await notify({ title: "postkasten: cannot push state", priority: "high", tags: ["rotating_light"], message: err.message });
      throw err;
    }

    try {
      const og = await fetchOg(cp.link, fetchResource);
      const card = { title: cp.title ?? og.title, description: cp.description ?? og.description, image: cp.image ?? og.image };
      if (!card.title) throw new Error(`${cp.link} has no og:title`);
      const image = card.image ? await fetchImage(card.image, fetchResource) : null;

      let result;
      if (channel === "bluesky") {
        bluesky ??= await loginBluesky(creds, config, apiFetch);
        const dup = isDuplicate(await bluesky.client.recentPosts(), { text: cp.text, link: cp.link });
        if (dup) {
          result = { id: dup.uri, url: blueskyUrl(dup.uri, bluesky.handle), duplicate: true };
        } else {
          const thumb = image ? await bluesky.client.uploadBlob(image.bytes, image.contentType) : undefined;
          const rec = buildRecord({ text: cp.text, createdAt: now, lang: cp.lang ?? "en", link: cp.link, title: card.title, description: card.description, thumb });
          const { uri } = await bluesky.client.createPost(rec);
          result = { id: uri, url: blueskyUrl(uri, bluesky.handle) };
        }
      } else {
        linkedin ??= createLinkedIn({ fetch: apiFetch, token: creds.linkedin.token, version: creds.linkedin.version ?? config.linkedinVersion });
        const { personUrn } = await linkedin.userinfo();
        const thumbnail = image ? await linkedin.uploadImage(personUrn, image.bytes, image.contentType) : undefined;
        const body = buildPost({ authorUrn: personUrn, text: cp.text, link: cp.link, title: card.title, description: card.description, thumbnail, visibility });
        const urn = await linkedin.createPost(body);
        result = { id: urn, url: linkedinUrl(urn) };
      }

      await record({ file: post.file, channel, status: "published", at: post.at, id: result.id, url: result.url, ...(result.duplicate ? { note: "already on the platform" } : {}) });
      summary.published.push({ file: post.file, channel, ...result });
      log(`published ${label}: ${result.url ?? result.id ?? "(no id returned)"}`);
      await notify({ title: `Posted on ${channel}`, tags: ["mailbox_with_mail"], message: `${card.title}\n${result.url ?? ""}`.trim(), click: result.url ?? undefined });
    } catch (err) {
      const n = failures + 1;
      log(`failed ${label}: ${err.message}`);
      try {
        await record({ file: post.file, channel, status: "failed", at: post.at, error: err.message });
      } catch (stateErr) {
        await notify({ title: "postkasten: state lost", priority: "high", tags: ["rotating_light"], message: `${label} failed (${err.message}) and the failed line could not be pushed: ${stateErr.message}` });
        throw stateErr;
      }
      summary.failed.push({ file: post.file, channel, error: err.message });
      await notify({
        title: n >= MAX_FAILURES ? `postkasten: giving up on ${channel}` : `postkasten: ${channel} failed (${n}/${MAX_FAILURES})`,
        priority: "high",
        tags: ["x"],
        message: `${label}\n${err.message}${n >= MAX_FAILURES ? "\nNo more attempts. Fix the cause and re-date the post." : ""}`,
      });
    }
  }
  return summary;
}

async function loginBluesky(creds, config, apiFetch) {
  const client = createBluesky({ fetch: apiFetch, service: config.bskyService });
  const { handle } = await client.login(creds.bluesky.handle, creds.bluesky.appPassword);
  return { client, handle };
}
