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
});
