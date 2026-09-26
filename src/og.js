/**
 * Reads the Open Graph tags of a page. LinkedIn does not scrape links posted
 * through the API and Bluesky link cards are client-built, so the tool needs
 * title, description and image itself. A regex is enough for `<meta>` tags in
 * `<head>`; this is not a general HTML parser.
 */

// Lowercase keys for case-insensitive entities, exact case for letters (auml vs Auml).
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201a",
  ldquo: "\u201c", rdquo: "\u201d", bdquo: "\u201e", laquo: "\u00ab", raquo: "\u00bb",
  euro: "\u20ac", copy: "\u00a9", reg: "\u00ae", trade: "\u2122", middot: "\u00b7", bull: "\u2022", shy: "\u00ad",
  auml: "\u00e4", ouml: "\u00f6", uuml: "\u00fc", Auml: "\u00c4", Ouml: "\u00d6", Uuml: "\u00dc", szlig: "\u00df",
  eacute: "\u00e9", Eacute: "\u00c9", egrave: "\u00e8", agrave: "\u00e0", aacute: "\u00e1", ccedil: "\u00e7",
};

/** Never throws: zero, surrogate and out-of-range code points become U+FFFD, unknown names stay as they are. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd";
    }
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** @returns {{ title?: string, description?: string, image?: string }} */
export function parseOg(html) {
  const head = html.slice(0, html.search(/<body[\s>]/i) === -1 ? html.length : html.search(/<body[\s>]/i));
  const out = {};
  for (const tag of head.matchAll(/<meta\s(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = Object.fromEntries(
      [...tag[0].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), m[3] ?? m[4]]),
    );
    const prop = attrs.property ?? attrs.name;
    if (!prop || attrs.content === undefined) continue;
    const key = { "og:title": "title", "og:description": "description", "og:image": "image" }[prop.toLowerCase()];
    if (key && out[key] === undefined) out[key] = decodeEntities(attrs.content).trim();
  }
  return out;
}

/**
 * @param {string} url
 * @param {(input: string, init?: object) => Promise<Response>} fetchImpl
 */
export async function fetchOg(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { accept: "text/html", "user-agent": "postkasten (+https://github.com/derblub/postkasten)" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  const og = parseOg(new TextDecoder().decode(await readBody(res, MAX_HTML_BYTES, true)));
  if (og.image) og.image = new URL(og.image, res.url || url).href;
  return og;
}

export const FETCH_TIMEOUT_MS = 15_000;
/** The og tags live in `<head>`; anything past this is not read. */
export const MAX_HTML_BYTES = 512 * 1024;
export const MAX_IMAGE_BYTES = 1_000_000;

/**
 * Reads at most `max` bytes. Returns null when the body is longer, unless
 * `truncate` is set, in which case the first `max` bytes are returned.
 */
async function readBody(res, max, truncate) {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.byteLength <= max ? all : truncate ? all.subarray(0, max) : null;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      if (!truncate) return null;
      break;
    }
  }
  const out = new Uint8Array(Math.min(size, max));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - off);
    out.set(part, off);
    off += part.length;
    if (off >= out.length) break;
  }
  return out;
}

/**
 * Downloads a card image and checks type and size (Bluesky's blob limit).
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>}
 */
export async function fetchImage(url, fetchImpl) {
  const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!["image/png", "image/jpeg"].includes(contentType)) {
    throw new Error(`${url} is ${contentType || "of unknown type"}, expected image/png or image/jpeg`);
  }
  const length = Number(res.headers.get("content-length"));
  const bytes = length > MAX_IMAGE_BYTES ? null : await readBody(res, MAX_IMAGE_BYTES, false);
  if (!bytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`${url} is ${length > MAX_IMAGE_BYTES ? length : "more than " + MAX_IMAGE_BYTES} bytes, limit is ${MAX_IMAGE_BYTES}`);
  }
  return { bytes, contentType };
}
