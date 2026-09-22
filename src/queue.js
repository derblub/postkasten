import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { parseAt } from "./schedule.js";

export const CHANNELS = ["linkedin", "bluesky"];
const CHANNEL_KEYS = new Set(["link", "title", "description", "image", "lang"]);

/**
 * A post file: front matter with `at` and one block per channel, then a
 * `## <channel>` section with the text for that channel.
 *
 * @typedef {{ link: string, title?: string, description?: string, image?: string, lang?: string, text: string }} ChannelPost
 * @typedef {{ file: string, at: string, atMs: number, offset: string, channels: Record<string, ChannelPost> }} Post
 */

/**
 * @param {string} source
 * @param {string} file  repo-relative path, used as the identity
 * @returns {Post}
 */
export function parsePost(source, file) {
  const { data, body } = parseFrontmatter(source);
  if (typeof data.at !== "string") throw new Error("`at` is missing");
  const { ms, offset } = parseAt(data.at);

  const sections = splitSections(body);
  const channels = {};
  for (const channel of CHANNELS) {
    const meta = data[channel];
    const text = sections[channel];
    if (meta === undefined && text === undefined) continue;
    if (meta === undefined) throw new Error(`section \`## ${channel}\` has no \`${channel}:\` block in the front matter`);
    if (typeof meta !== "object") throw new Error(`\`${channel}:\` must be a block with at least \`link\``);
    if (text === undefined) throw new Error(`\`${channel}:\` block has no \`## ${channel}\` section`);
    if (!meta.link) throw new Error(`\`${channel}.link\` is missing`);
    for (const key of Object.keys(meta)) {
      if (!CHANNEL_KEYS.has(key)) throw new Error(`unknown key \`${channel}.${key}\``);
    }
    if (!text.trim()) throw new Error(`section \`## ${channel}\` is empty`);
    channels[channel] = { ...meta, text: text.trim() };
  }
  for (const key of Object.keys(data)) {
    if (key !== "at" && !CHANNELS.includes(key)) throw new Error(`unknown front matter key \`${key}\``);
  }
  for (const name of Object.keys(sections)) {
    if (!CHANNELS.includes(name)) throw new Error(`unknown section \`## ${name}\``);
  }
  if (Object.keys(channels).length === 0) throw new Error("post has no channel");

  return { file, at: data.at.trim(), atMs: ms, offset, channels };
}

function splitSections(body) {
  const sections = {};
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const m = /^##\s+(\S+)\s*$/.exec(line);
    if (m) {
      current = m[1].toLowerCase();
      sections[current] = "";
      continue;
    }
    if (current === null) {
      if (line.trim()) throw new Error("text before the first `## <channel>` heading");
      continue;
    }
    sections[current] += line + "\n";
  }
  return sections;
}

/**
 * Loads every `*.md` under the posts directory. Files that fail to parse are
 * returned under `errors`, so one broken file never blocks the others.
 * @returns {Promise<{ posts: Post[], errors: { file: string, error: string }[] }>}
 */
export async function loadQueue(cwd, postsDir) {
  const dir = join(cwd, postsDir);
  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch (err) {
    if (err.code === "ENOENT") return { posts: [], errors: [] };
    throw err;
  }
  const posts = [];
  const errors = [];
  for (const name of names) {
    const abs = join(dir, name);
    const file = relative(cwd, abs).split("\\").join("/");
    try {
      posts.push(parsePost(await readFile(abs, "utf8"), file));
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }
  posts.sort((a, b) => a.atMs - b.atMs || a.file.localeCompare(b.file));
  return { posts, errors };
}
