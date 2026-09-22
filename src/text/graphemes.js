const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Number of user-perceived characters, which is what Bluesky's 300 limit counts. */
export function countGraphemes(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** Cuts a string to at most `max` graphemes, never inside a cluster. */
export function truncateGraphemes(text, max) {
  if (countGraphemes(text) <= max) return text;
  let out = "";
  let n = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (n === max) break;
    out += segment;
    n++;
  }
  return out;
}
