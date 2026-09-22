/**
 * LinkedIn's Posts API reads `commentary` in its "little" text format, where
 * these characters are markup and must be backslash-escaped to appear
 * literally:  \ | { } @ [ ] ( ) < > # * _ ~
 *
 * The one deliberate exception: a `#` that starts a hashtag stays as it is,
 * so LinkedIn renders it as a hashtag. Everything else is escaped.
 */

const SPECIAL = new Set(["\\", "|", "{", "}", "@", "[", "]", "(", ")", "<", ">", "#", "*", "_", "~"]);

export function escapeLittle(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!SPECIAL.has(ch)) {
      out += ch;
      continue;
    }
    if (ch === "#" && isHashtagStart(text, i)) {
      out += ch;
      continue;
    }
    out += "\\" + ch;
  }
  return out;
}

function isHashtagStart(text, i) {
  const before = i === 0 ? " " : text[i - 1];
  const after = text[i + 1] ?? "";
  return /\s/.test(before) && /[\p{L}\p{N}_]/u.test(after);
}

export const LINKEDIN_MAX_COMMENTARY = 3000;
