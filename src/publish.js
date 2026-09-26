import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createLinkedIn, postUrl as linkedinUrl } from "./linkedin/client.js";
import { buildPost } from "./linkedin/posts.js";
import { createBluesky, postUrl as blueskyUrl } from "./bluesky/client.js";
import { buildRecord, isDuplicate } from "./bluesky/embed.js";
import { fetchImage, fetchOg } from "./og.js";
import { parseState, resolveStatus, serializeEntry, MAX_FAILURES } from "./state.js";
import { linkedinVersion } from "./config.js";
import { formatLocal, isDue, overdueHours } from "./schedule.js";
import { validate, readOptional } from "./validate.js";

/**
 * Publishes every due post. See docs/ci.md for the guarantees:
 * git preflight before anything is posted, candidates re-read from the synced
 * tree, an `intent` line pushed before each attempt, a `published` line pushed
 * right after, one failure never blocks the other candidates, a create request
 * with an unknown outcome leaves the intent open.
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
  const summary = { published: [], failed: [], skipped: [], blocked: [], givenUp: [], invalid: [], invalidDue: [], disabled: [], candidates: 0 };
  const enabled = new Set(config.channels);
  const statePath = join(cwd, config.stateFile);
  const now = new Date(nowMs).toISOString();

  // Reads queue and state from the working tree. Runs once to decide whether
  // git is needed at all and again after preflight synced the tree to origin;
  // only the second pass is reported and published.
  const collect = async () => {
    const { problems, posts } = await validate({ cwd, config, online: false });
    const errorsOf = (file) => problems.filter((p) => p.file === file && p.level === "error").map((p) => p.message);
    const invalid = [...new Set(problems.filter((p) => p.level === "error").map((p) => p.file))].map((file) => ({ file, errors: errorsOf(file) }));
    const invalidFiles = new Set(invalid.map((i) => i.file));
    const state = parseState(await readOptional(statePath));
    const pass = { state, invalid, invalidDue: [], blocked: [], givenUp: [], disabled: [], candidates: [] };
    for (const post of posts) {
      if (!isDue(post.atMs, nowMs)) continue;
      if (invalidFiles.has(post.file)) {
        // Past the due window it will never be posted; only the log lists it then.
        const open = overdueHours(post.atMs, nowMs) <= config.dueWindowHours && Object.keys(post.channels).some((ch) => enabled.has(ch) && !["published", "skipped", "given_up"].includes(resolveStatus(state, post.file, ch, post.at).status));
        if (open) pass.invalidDue.push({ file: post.file, errors: errorsOf(post.file) });
        continue;
      }
      for (const channel of Object.keys(post.channels)) {
        const status = resolveStatus(state, post.file, channel, post.at);
        if (!enabled.has(channel)) {
          if (status.status !== "published") pass.disabled.push({ file: post.file, channel });
          continue;
        }
        if (status.status === "published" || status.status === "skipped") continue;
        if (status.status === "blocked") pass.blocked.push({ file: post.file, channel, since: status.entry.ts });
        else if (status.status === "given_up") pass.givenUp.push({ file: post.file, channel });
        else pass.candidates.push({ post, channel, failures: status.failures });
      }
    }
    return pass;
  };

  // Anything to post or to report is decided on the synced tree: a stale
  // checkout must neither post again nor raise a false alarm.
  let pass = await collect();
  if (pass.candidates.length || pass.blocked.length || pass.invalidDue.length) {
    try {
      await git.preflight();
    } catch (err) {
      log(err.message);
      await notify({ title: "postkasten: git preflight failed", priority: "high", tags: ["rotating_light"], message: err.message });
      throw err;
    }
    pass = await collect();
  }
  const { state, candidates } = pass;

  for (const { file, errors } of pass.invalid) {
    summary.invalid.push(file);
    log(`skipping ${file}: ${errors.join("; ")}`);
  }
  summary.invalidDue = pass.invalidDue.map((i) => i.file);
  for (const d of pass.disabled) {
    summary.disabled.push(d);
    log(`waiting: ${d.file} ${d.channel} (channel not enabled in config)`);
  }
  for (const b of pass.blocked) {
    summary.blocked.push({ file: b.file, channel: b.channel });
    log(`blocked: ${b.file} ${b.channel} has an open intent from ${b.since}`);
  }
  summary.givenUp.push(...pass.givenUp);
  summary.candidates = candidates.length;

  if (pass.invalidDue.length) {
    await notify({
      title: "postkasten: due post is invalid",
      priority: "high",
      tags: ["warning"],
      message: pass.invalidDue.map((i) => `${i.file}: ${i.errors.join("; ")}`).join("\n") + "\nNot posted. Fix it (postkasten validate); the next run posts it.",
    });
  }
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

  // `recheck` runs on origin's tree before the line is appended again after a
  // rejected push, and throws when the line no longer applies.
  const record = async (entry, recheck) => {
    const line = { ...entry, ts: new Date().toISOString() };
    state.push(line);
    if (dryRun) {
      log(`[dry run] state += ${JSON.stringify(line)}`);
      return;
    }
    const append = () => appendFile(statePath, serializeEntry(line));
    await append();
    await git.commitAndPush([config.stateFile], `${entry.status}: ${entry.channel} ${entry.file}`, async () => {
      await recheck?.();
      await append();
    });
  };

  // Another run (or an edit) pushed while we prepared: post only if the
  // (file, channel) is still pending and the post is unchanged on origin.
  const stillPending = (post, channel) => async () => {
    const { problems, posts } = await validate({ cwd, config, online: false });
    const fresh = posts.find((p) => p.file === post.file);
    const unchanged = fresh && fresh.at === post.at && JSON.stringify(fresh.channels[channel]) === JSON.stringify(post.channels[channel])
      && !problems.some((p) => p.file === post.file && p.level === "error");
    if (!unchanged) throw new Error(`${post.file} changed on origin during the run`);
    const { status } = resolveStatus(parseState(await readOptional(statePath)), post.file, channel, post.at);
    if (status !== "pending") throw new Error(`${post.file} ${channel} is ${status} on origin`);
  };

  // Read-only work is cached per run: one login per channel, one fetch per URL.
  // Rejections are cached too, so a bad credential is tried once, not per post.
  const cache = new Map();
  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };

  for (const { post, channel, failures } of candidates) {
    const cp = post.channels[channel];
    const label = `${post.file} (${channel}, ${formatLocal(post.atMs, config.timezone)})`;
    const resolveHint = `postkasten resolve ${post.file} ${channel}`;

    const hours = overdueHours(post.atMs, nowMs);
    if (hours > config.dueWindowHours) {
      await record({ file: post.file, channel, status: "skipped", at: post.at, reason: `overdue ${hours.toFixed(1)}h` });
      summary.skipped.push({ file: post.file, channel });
      log(`skipped ${label}: overdue ${hours.toFixed(1)} h`);
      await notify({ title: "postkasten: post skipped", priority: "default", tags: ["hourglass"], message: `${label} was ${hours.toFixed(1)} h overdue and was not posted. Re-date it to post it.` });
      continue;
    }

    const fail = async (err) => {
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
    };

    // Everything that cannot create a post happens before the intent.
    let card, image, session;
    try {
      const needOg = cp.title === undefined || cp.description === undefined || cp.image === undefined;
      const og = needOg ? await once(`og ${cp.link}`, () => fetchOg(cp.link, fetchResource)) : {};
      card = { title: cp.title ?? og.title, description: cp.description ?? og.description, image: cp.image ?? og.image };
      if (!card.title) throw new Error(`${cp.link} has no og:title`);
      image = card.image ? await once(`image ${card.image}`, () => fetchImage(card.image, fetchResource)) : null;
      session = channel === "bluesky"
        ? await once("bluesky", () => loginBluesky(creds, config, apiFetch))
        : await once("linkedin", () => loginLinkedIn(creds, config, apiFetch));
    } catch (err) {
      await fail(err);
      continue;
    }

    try {
      await record({ file: post.file, channel, status: "intent", at: post.at }, stillPending(post, channel));
    } catch (err) {
      log(`cannot write intent, stopping: ${err.message}`);
      await notify({ title: "postkasten: cannot push state", priority: "high", tags: ["rotating_light"], message: err.message });
      throw err;
    }

    let result;
    let sent = false;
    try {
      if (channel === "bluesky") {
        const dup = isDuplicate(await session.client.recentPosts(), { text: cp.text, link: cp.link });
        if (dup) {
          result = { id: dup.uri, url: blueskyUrl(dup.uri, session.handle), duplicate: true };
        } else {
          const thumb = image ? await session.client.uploadBlob(image.bytes, image.contentType) : undefined;
          const rec = buildRecord({ text: cp.text, createdAt: now, lang: cp.lang ?? "en", link: cp.link, title: card.title, description: card.description, thumb });
          sent = true;
          const { uri } = await session.client.createPost(rec);
          if (!uri) throw new Error("Bluesky createRecord returned no uri");
          result = { id: uri, url: blueskyUrl(uri, session.handle) };
        }
      } else {
        const thumbnail = image ? await session.client.uploadImage(session.personUrn, image.bytes, image.contentType) : undefined;
        const body = buildPost({ authorUrn: session.personUrn, text: cp.text, link: cp.link, title: card.title, description: card.description, thumbnail, visibility });
        sent = true;
        const urn = await session.client.createPost(body);
        if (!urn) throw new Error("LinkedIn created the post but returned no id (x-restli-id)");
        result = { id: urn, url: linkedinUrl(urn) };
      }
    } catch (err) {
      if (!sent || isRejection(err)) {
        await fail(err);
        continue;
      }
      // The create request may have succeeded: keep the intent open, never retry blindly.
      log(`outcome unknown ${label}: ${err.message}`);
      summary.failed.push({ file: post.file, channel, error: err.message, note: "outcome unknown, intent left open" });
      await notify({
        title: `postkasten: ${channel} outcome unknown`,
        priority: "high",
        tags: ["warning"],
        message: `${label}\n${err.message}\nThe post may exist. Check ${channel} and run: ${resolveHint} --published <id> | --drop`,
      });
      continue;
    }

    try {
      await record({ file: post.file, channel, status: "published", at: post.at, id: result.id, url: result.url, ...(result.duplicate ? { note: "already on the platform" } : {}) });
    } catch (stateErr) {
      log(`published ${label} but cannot push state, stopping: ${stateErr.message}`);
      await notify({
        title: "postkasten: state lost",
        priority: "high",
        tags: ["rotating_light"],
        click: result.url ?? undefined,
        message: `${label} is live (${result.url ?? result.id}) but the published line could not be pushed: ${stateErr.message}\nRun: ${resolveHint} --published ${result.id}\nthen commit and push ${config.stateFile}.`,
      });
      throw stateErr;
    }
    summary.published.push({ file: post.file, channel, ...result });
    log(`published ${label}: ${result.url ?? result.id}`);
    await notify({ title: `Posted on ${channel}`, tags: ["mailbox_with_mail"], message: `${card.title}\n${result.url ?? ""}`.trim(), click: result.url ?? undefined });
  }
  return summary;
}

/** An HTTP answer that proves nothing was created (4xx except timeout and rate limit). */
function isRejection(err) {
  const s = err?.status;
  return typeof s === "number" && s >= 400 && s < 500 && s !== 408 && s !== 429;
}

async function loginLinkedIn(creds, config, apiFetch) {
  const client = createLinkedIn({ fetch: apiFetch, token: creds.linkedin.token, version: linkedinVersion(creds, config) });
  const { personUrn } = await client.userinfo();
  return { client, personUrn };
}

async function loginBluesky(creds, config, apiFetch) {
  const client = createBluesky({ fetch: apiFetch, service: config.bskyService });
  const { handle } = await client.login(creds.bluesky.handle, creds.bluesky.appPassword);
  return { client, handle };
}
