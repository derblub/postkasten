import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadQueue } from "./queue.js";
import { offsetAt } from "./schedule.js";
import { parseState, orphanedEntries, openIntents } from "./state.js";
import { countGraphemes } from "./text/graphemes.js";
import { buildFacets, findUrls } from "./text/facets.js";
import { escapeLittle, LINKEDIN_MAX_COMMENTARY } from "./text/linkedin-escape.js";
import { checkRules, describeRule, parseRules } from "./text/rules.js";
import { BLUESKY_MAX_GRAPHEMES } from "./bluesky/embed.js";
import { fetchImage, fetchOg } from "./og.js";

export async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Checks every post file. `online: false` skips the network checks (link
 * reachability, OG tags, image size) for fast local feedback.
 * @returns {Promise<{ ok: boolean, problems: { file: string, level: 'error'|'warning', message: string }[], posts: import('./queue.js').Post[] }>}
 */
export async function validate({ cwd, config, online = true, fetch: fetchImpl = globalThis.fetch }) {
  const problems = [];
  const add = (file, level, message) => problems.push({ file, level, message });

  const { posts, errors } = await loadQueue(cwd, config.postsDir);
  for (const { file, error } of errors) add(file, "error", error);

  const rules = parseRules(await readOptional(join(cwd, config.rulesFile)));
  const state = parseState(await readOptional(join(cwd, config.stateFile)));

  for (const post of posts) {
    const expected = offsetAt(post.atMs, config.timezone);
    if (expected !== post.offset) {
      add(post.file, "error", `\`at\` has offset ${post.offset}, but ${config.timezone} is ${expected} at that time`);
    }
    for (const [channel, cp] of Object.entries(post.channels)) {
      for (const key of ["text", "title", "description"]) {
        if (typeof cp[key] !== "string") continue;
        const what = key === "text" ? "text" : `${channel}.${key}`;
        for (const rule of checkRules(cp[key], rules)) add(post.file, "error", `${channel}: ${what} contains ${describeRule(rule)}`);
      }
      for (const key of ["link", "image"]) {
        if (cp[key] && !/^https?:\/\//.test(cp[key])) add(post.file, "error", `${channel}.${key} must be an absolute http(s) URL`);
        if (cp[key]?.includes("utm_")) add(post.file, "error", `${channel}.${key} carries utm_ parameters`);
      }
      if (channel === "linkedin") {
        const escaped = escapeLittle(cp.text);
        if (escaped.length > LINKEDIN_MAX_COMMENTARY) {
          add(post.file, "error", `linkedin: ${escaped.length} characters after escaping, limit is ${LINKEDIN_MAX_COMMENTARY}`);
        }
        const urls = findUrls(cp.text).map((u) => u.url);
        if (!urls.some((u) => u.replace(/\/$/, "") === cp.link.replace(/\/$/, ""))) {
          add(post.file, "warning", "linkedin: text does not contain the card link (LinkedIn shows card and text link differently in reach)");
        }
        if (/(^|\s)pushingpixels\.at\//.test(cp.text) || /(^|\s)[a-z0-9-]+\.[a-z]{2,}\/\S/.test(cp.text)) {
          add(post.file, "warning", "linkedin: a link without https:// is not reliably clickable");
        }
      }
      if (channel === "bluesky") {
        const n = countGraphemes(cp.text);
        if (n > BLUESKY_MAX_GRAPHEMES) add(post.file, "error", `bluesky: ${n} graphemes, limit is ${BLUESKY_MAX_GRAPHEMES}`);
        if (findUrls(cp.text).length) add(post.file, "warning", "bluesky: text contains a URL although the link card already carries the link");
        try {
          buildFacets(cp.text);
        } catch (err) {
          add(post.file, "error", `bluesky: cannot build facets: ${err.message}`);
        }
      }
    }
  }

  if (online) {
    for (const post of posts) {
      for (const [channel, cp] of Object.entries(post.channels)) {
        try {
          const og = await fetchOg(cp.link, fetchImpl);
          if (!cp.title && !og.title) add(post.file, "error", `${channel}: ${cp.link} has no og:title and no title override`);
          const image = cp.image ?? og.image;
          if (!image) add(post.file, "warning", `${channel}: no image for the link card`);
          else await fetchImage(image, fetchImpl);
        } catch (err) {
          add(post.file, "error", `${channel}: ${err.message}`);
        }
      }
    }
  }

  for (const entry of orphanedEntries(state, posts.map((p) => p.file))) {
    add(entry.file, "warning", `state has a \`${entry.status}\` line for a file that no longer exists (renamed after publish?)`);
  }
  for (const intent of openIntents(state)) {
    add(intent.file, "warning", `open intent for ${intent.channel} since ${intent.ts}; resolve it before the next publish`);
  }

  return { ok: !problems.some((p) => p.level === "error"), problems, posts };
}
