import { describe, expect, it } from "vitest";
import { decodeEntities, fetchImage, fetchOg, parseOg } from "../src/og.js";

const HTML = `<!doctype html><html><head>
<meta property="og:title" content="Zero-downtime migrations &amp; you">
<meta content='Desc &quot;q&quot; &#8364;' property='og:description'>
<meta property="og:image" content="/og/de/x.png">
<meta name="og:title" content="ignored, first wins">
</head><body><meta property="og:title" content="not in head"></body></html>`;

describe("parseOg", () => {
  it("reads og tags in either attribute order and decodes entities", () => {
    expect(parseOg(HTML)).toEqual({ title: "Zero-downtime migrations & you", description: 'Desc "q" €', image: "/og/de/x.png" });
    expect(decodeEntities("&#x41;&amp;&nbsp;")).toBe("A& ");
  });
});

describe("fetchOg / fetchImage", () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/page")) return new Response(HTML, { status: 200, headers: { "content-type": "text/html" } });
    if (url.endsWith("/og/de/x.png")) return new Response(new Uint8Array(10), { status: 200, headers: { "content-type": "image/png" } });
    if (url.endsWith("/big.png")) return new Response(new Uint8Array(1_000_001), { status: 200, headers: { "content-type": "image/png" } });
    if (url.endsWith("/x.gif")) return new Response(new Uint8Array(1), { status: 200, headers: { "content-type": "image/gif" } });
    return new Response("", { status: 404 });
  };
  it("resolves the image against the page URL", async () => {
    expect((await fetchOg("https://s.example/page", fetchImpl)).image).toBe("https://s.example/og/de/x.png");
  });
  it("enforces type and size", async () => {
    expect((await fetchImage("https://s.example/og/de/x.png", fetchImpl)).contentType).toBe("image/png");
    await expect(fetchImage("https://s.example/big.png", fetchImpl)).rejects.toThrow(/limit/);
    await expect(fetchImage("https://s.example/x.gif", fetchImpl)).rejects.toThrow(/image\/gif/);
    await expect(fetchOg("https://s.example/nope", fetchImpl)).rejects.toThrow(/404/);
  });
  it("passes a timeout signal", async () => {
    const seen = [];
    const spy = async (url, init) => (seen.push(init?.signal), fetchImpl(url, init));
    await fetchOg("https://s.example/page", spy);
    await fetchImage("https://s.example/og/de/x.png", spy);
    expect(seen.every((s) => s instanceof AbortSignal)).toBe(true);
  });
  it("resolves the image against the final URL after redirects", async () => {
    const redirected = async () => {
      const res = new Response('<head><meta property="og:image" content="card.png"><meta property="og:title" content="t"></head>', { status: 200 });
      Object.defineProperty(res, "url", { value: "https://blog.other.example/post/" });
      return res;
    };
    expect((await fetchOg("https://short.example/x", redirected)).image).toBe("https://blog.other.example/post/card.png");
  });
  it("rejects oversized images by content-length without reading the body", async () => {
    let pulled = 0;
    const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } });
    const res = new Response(body, { status: 200, headers: { "content-type": "image/jpeg", "content-length": "50000000" } });
    await expect(fetchImage("https://s.example/huge.jpg", async () => res)).rejects.toThrow(/50000000 bytes/);
    expect(pulled).toBeLessThan(3);
  });
  it("stops reading an endless image or page at the limit", async () => {
    const endless = (type) => async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(64 * 1024)); } }), { status: 200, headers: { "content-type": type } });
    await expect(fetchImage("https://s.example/e.png", endless("image/png"))).rejects.toThrow(/more than 1000000 bytes/);
    const page = async () => {
      let first = true;
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ pull(c) {
        c.enqueue(first ? enc.encode('<head><meta property="og:title" content="T">') : new Uint8Array(64 * 1024).fill(32));
        first = false;
      } }), { status: 200 });
    };
    expect(await fetchOg("https://s.example/endless", page)).toEqual({ title: "T" });
  });
});
