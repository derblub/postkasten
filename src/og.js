/**
 * Reads the Open Graph tags of a page. LinkedIn does not scrape links posted
 * through the API and Bluesky link cards are client-built, so the tool needs
 * title, description and image itself. A regex is enough for `<meta>` tags in
 * `<head>`; this is not a general HTML parser.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: "\u00a0" };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** @returns {{ title?: string, description?: string, image?: string }} */
export function parseOg(html) {
  const head = html.slice(0, html.search(/<body[\s>]/i) === -1 ? html.length : html.search(/<body[\s>]/i));
  const out = {};
  for (const tag of head.matchAll(/<meta\s[^>]*>/gi)) {
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
  });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  const og = parseOg(await res.text());
  if (og.image) og.image = new URL(og.image, url).href;
  return og;
}

export const MAX_IMAGE_BYTES = 1_000_000;

/**
 * Downloads a card image and checks type and size (Bluesky's blob limit).
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>}
 */
export async function fetchImage(url, fetchImpl) {
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!["image/png", "image/jpeg"].includes(contentType)) {
    throw new Error(`${url} is ${contentType || "of unknown type"}, expected image/png or image/jpeg`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${url} is ${bytes.byteLength} bytes, limit is ${MAX_IMAGE_BYTES}`);
  }
  return { bytes, contentType };
}
