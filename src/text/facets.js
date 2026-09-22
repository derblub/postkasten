/**
 * Detects links and hashtags in plain text and returns them with UTF-8 byte
 * offsets, the way Bluesky's rich text facets expect. Byte offsets differ from
 * string indices as soon as an umlaut, a euro sign or an emoji appears, so the
 * offsets are computed from the encoded prefix, never from `index`.
 */

const encoder = new TextEncoder();
const URL_RE = /https?:\/\/[^\s<>()]+/g;
// Bluesky's own rule: a `#`, not followed by a digit, after start or whitespace.
const TAG_RE = /(?:^|\s)(#[^\d\s]\S*)/g;
const TRAILING_PUNCT = /[.,;:!?'")\]]+$/;
const MAX_TAG = 64;

function byteLength(str) {
  return encoder.encode(str).byteLength;
}

/** @returns {{ start: number, end: number, url: string }[]} string indices */
export function findUrls(text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCT, "");
    if (!url) continue;
    out.push({ start: m.index, end: m.index + url.length, url });
  }
  return out;
}

/** @returns {{ start: number, end: number, tag: string }[]} string indices; `tag` without `#` */
export function findHashtags(text) {
  const out = [];
  for (const m of text.matchAll(TAG_RE)) {
    const raw = m[1].replace(TRAILING_PUNCT, "");
    const tag = raw.slice(1);
    if (!tag || tag.length > MAX_TAG) continue;
    const start = m.index + m[0].indexOf("#");
    out.push({ start, end: start + raw.length, tag });
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
