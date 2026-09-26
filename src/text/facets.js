/**
 * Detects links and hashtags in plain text and returns them with UTF-8 byte
 * offsets, the way Bluesky's rich text facets expect. Byte offsets differ from
 * string indices as soon as an umlaut, a euro sign or an emoji appears, so the
 * offsets are computed from the encoded prefix, never from `index`.
 */

import { countGraphemes } from "./graphemes.js";

const encoder = new TextEncoder();
const URL_RE = /https?:\/\/[^\s<>]+/g;
const INVISIBLE = "\u00AD\u2060\u200A\u200B\u200C\u200D\u20E2";
// Bluesky's own rule: `#` or `＃` after start or whitespace; the tag needs at
// least one character that is not a digit, space or punctuation.
const TAG_RE = new RegExp(
  `(?:^|\\s)([#＃])((?!\uFE0F)[^\\s${INVISIBLE}]*[^\\d\\s\\p{P}${INVISIBLE}]+[^\\s${INVISIBLE}]*)?`,
  "gu",
);
const MAX_TAG = 64;
// ASCII sentence punctuation plus typographic quotes and the ellipsis.
const URL_TRAILING = /[.,;:!?'"\]\p{Pi}\p{Pf}\u201E\u201A\u2026]+$/u;

function byteLength(str) {
  return encoder.encode(str).byteLength;
}

/** Strips trailing punctuation, keeping a `)` that closes a `(` inside the URL. */
function trimUrl(raw) {
  let url = raw;
  for (;;) {
    const t = url.replace(URL_TRAILING, "");
    if (t.endsWith(")") && count(t, ")") > count(t, "(")) {
      url = t.slice(0, -1);
      continue;
    }
    return t;
  }
}

function count(str, ch) {
  return str.split(ch).length - 1;
}

/** @returns {{ start: number, end: number, url: string }[]} string indices */
export function findUrls(text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (!/^https?:\/\/./.test(url)) continue;
    out.push({ start: m.index, end: m.index + url.length, url });
  }
  return out;
}

/** @returns {{ start: number, end: number, tag: string }[]} string indices; `tag` without `#` */
export function findHashtags(text) {
  const out = [];
  for (const m of text.matchAll(TAG_RE)) {
    if (!m[2]) continue;
    const tag = m[2].replace(/\p{P}+$/u, "");
    if (!tag || countGraphemes(tag) > MAX_TAG) continue;
    const start = m.index + m[0].indexOf(m[1]);
    out.push({ start, end: start + m[1].length + tag.length, tag });
  }
  return out;
}

/**
 * Bluesky facets for links and hashtags in `text`.
 * @returns {Array<{ index: { byteStart: number, byteEnd: number }, features: object[] }>}
 */
export function buildFacets(text) {
  const facets = [];
  for (const { start, end, url } of findUrls(text)) {
    facets.push({
      index: { byteStart: byteLength(text.slice(0, start)), byteEnd: byteLength(text.slice(0, end)) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
    });
  }
  for (const { start, end, tag } of findHashtags(text)) {
    facets.push({
      index: { byteStart: byteLength(text.slice(0, start)), byteEnd: byteLength(text.slice(0, end)) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}
