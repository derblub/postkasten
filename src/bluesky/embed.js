import { buildFacets } from "../text/facets.js";
import { countGraphemes, truncateGraphemes } from "../text/graphemes.js";

export const BLUESKY_MAX_GRAPHEMES = 300;
export const CARD_TITLE_MAX = 200;
export const CARD_DESCRIPTION_MAX = 300;

/**
 * An `app.bsky.feed.post` record with facets and an external link card.
 * `thumb` is the blob returned by uploadBlob (optional).
 */
export function buildRecord({ text, createdAt, lang = "en", link, title, description, thumb }) {
  const graphemes = countGraphemes(text);
  if (graphemes > BLUESKY_MAX_GRAPHEMES) {
    throw new Error(`Bluesky text is ${graphemes} graphemes, limit is ${BLUESKY_MAX_GRAPHEMES}`);
  }
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt,
    langs: [lang],
  };
  const facets = buildFacets(text);
  if (facets.length) record.facets = facets;
  if (link) {
    const external = { uri: link, title: clip(title ?? link, CARD_TITLE_MAX), description: clip(description ?? "", CARD_DESCRIPTION_MAX) };
    if (thumb) external.thumb = thumb;
    record.embed = { $type: "app.bsky.embed.external", external };
  }
  return record;
}

function clip(text, max) {
  const s = String(text).trim();
  return countGraphemes(s) > max ? truncateGraphemes(s, max - 1).trimEnd() + "…" : s;
}

/** True when a recent post carries this exact text and, if there is a link, the same card URL. */
export function isDuplicate(recent, { text, link }) {
  return recent.find((p) => p?.record?.text === text && (!link || p?.embed?.external?.uri === link)) ?? null;
}
