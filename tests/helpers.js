import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXAMPLE = fileURLToPath(new URL("../examples/content-repo/", import.meta.url));

export async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), "postkasten-"));
  await cp(EXAMPLE, dir, { recursive: true });
  return dir;
}

export const readState = async (dir) => (await readFile(join(dir, "state/published.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
export const writeState = (dir, lines) => writeFile(join(dir, "state/published.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""));

const HTML = (title, image) => `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="Desc"><meta property="og:image" content="${image}"></head><body></body></html>`;

/** Serves OG pages and a tiny PNG for the example post's links. */
export const resourceFetch = async (url) => {
  const u = String(url);
  if (u.endsWith(".png")) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
  if (u.includes("/de/portfolio/")) return new Response(HTML("Migrationen ohne Wartungsfenster", "/og/de/zero-downtime-migrations.png"), { status: 200, headers: { "content-type": "text/html" } });
  if (u.includes("/portfolio/")) return new Response(HTML("Zero-downtime migrations", "/og/zero-downtime-migrations.png"), { status: 200, headers: { "content-type": "text/html" } });
  return new Response("", { status: 404 });
};
