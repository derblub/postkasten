/**
 * Copy rules: substrings that must not appear in a post. A content repo adds
 * its own in `rules/forbidden.txt` (one entry per line, `#` comments); these
 * defaults always apply.
 */

export const DEFAULT_FORBIDDEN = [
  "—", // em dash
  "–", // en dash
  "utm_", // no tracking parameters in links
];

/**
 * @param {string} fileContent  Contents of forbidden.txt, or "".
 * @returns {string[]}
 */
export function parseRules(fileContent) {
  return fileContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * @returns {string[]} the rules that `text` violates (case-insensitive)
 */
export function checkRules(text, rules) {
  const haystack = text.toLowerCase();
  return [...new Set([...DEFAULT_FORBIDDEN, ...rules])].filter((rule) =>
    haystack.includes(rule.toLowerCase()),
  );
}

export function describeRule(rule) {
  if (rule === "—") return "em dash (U+2014)";
  if (rule === "–") return "en dash (U+2013)";
  return `"${rule}"`;
}
