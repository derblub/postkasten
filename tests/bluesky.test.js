import { describe, expect, it } from "vitest";
import { createBluesky, postUrl, rkeyOf } from "../src/bluesky/client.js";
import { buildRecord, isDuplicate } from "../src/bluesky/embed.js";
import { countGraphemes } from "../src/text/graphemes.js";
import { mergeProfile, parseProfile } from "../src/bluesky/profile.js";

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) if (String(url).includes(match)) return handler(init);
    return new Response("nope", { status: 404 });
  };
  f.calls = calls;
  return f;
}

describe("createBluesky", () => {
  it("logs in, uploads, creates and lists", async () => {
    const f = fakeFetch([
      ["createSession", () => Response.json({ did: "did:plc:1", handle: "h.example", accessJwt: "jwt" })],
      ["uploadBlob", () => Response.json({ blob: { $type: "blob", ref: { $link: "b" }, mimeType: "image/png", size: 3 } })],
      ["createRecord", () => Response.json({ uri: "at://did:plc:1/app.bsky.feed.post/rk", cid: "c" })],
      ["getAuthorFeed", () => Response.json({ feed: [{ post: { author: { did: "did:plc:1" }, record: { text: "x" } } }, { post: { author: { did: "did:plc:2" }, record: { text: "repost" } } }] })],
    ]);
    const b = createBluesky({ fetch: f });
    expect(await b.login("h.example", "pw")).toEqual({ did: "did:plc:1", handle: "h.example" });
    expect(JSON.parse(f.calls[0].init.body)).toEqual({ identifier: "h.example", password: "pw" });
    expect((await b.uploadBlob(new Uint8Array(3), "image/png")).mimeType).toBe("image/png");
    expect(f.calls[1].init.headers).toMatchObject({ authorization: "Bearer jwt", "content-type": "image/png" });
    expect((await b.createPost({ text: "x" })).uri).toContain("/rk");
    expect(JSON.parse(f.calls[2].init.body)).toMatchObject({ repo: "did:plc:1", collection: "app.bsky.feed.post" });
    expect((await b.recentPosts()).map((p) => p.record.text)).toEqual(["x"]);
  });
  it("reports missing credentials and API errors", async () => {
    await expect(createBluesky({ fetch: fakeFetch([]) }).login("", "")).rejects.toThrow(/BLUESKY_HANDLE/);
    const b = createBluesky({ fetch: fakeFetch([["createSession", () => new Response('{"error":"AuthenticationRequired"}', { status: 401 })]]) });
    await expect(b.login("h", "p")).rejects.toThrow(/Bluesky com.atproto.server.createSession returned 401/);
  });
  it("converts at-URIs to web URLs", () => {
    expect(postUrl("at://did:plc:1/app.bsky.feed.post/rk", "h.example")).toBe("https://bsky.app/profile/h.example/post/rk");
    expect(rkeyOf("at://did:plc:1/app.bsky.feed.post/rk")).toBe("rk");
    expect(rkeyOf("https://bsky.app/profile/h.example/post/rk/")).toBe("rk");
    expect(rkeyOf("rk")).toBe("rk");
    expect(rkeyOf("")).toBeNull();
    expect(postUrl("nope")).toBeNull();
  });
});

describe("buildRecord", () => {
  it("adds facets, langs and the external embed", () => {
    const rec = buildRecord({ text: "Hello #Django", createdAt: "2026-09-29T06:30:00.000Z", link: "https://x.example/p", title: "T", description: "D", thumb: { $type: "blob" } });
    expect(rec).toEqual({
      $type: "app.bsky.feed.post",
      text: "Hello #Django",
      createdAt: "2026-09-29T06:30:00.000Z",
      langs: ["en"],
      facets: [{ index: { byteStart: 6, byteEnd: 13 }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: "Django" }] }],
      embed: { $type: "app.bsky.embed.external", external: { uri: "https://x.example/p", title: "T", description: "D", thumb: { $type: "blob" } } },
    });
    expect(() => buildRecord({ text: "🚀".repeat(301), createdAt: "x" })).toThrow(/301 graphemes/);
  });
  it("detects duplicates only when text and card URL both match", () => {
    const recent = [{ record: { text: "same" }, embed: { external: { uri: "https://x.example/a" } } }];
    expect(isDuplicate(recent, { text: "same", link: "https://x.example/a" })).toBeTruthy();
    expect(isDuplicate(recent, { text: "same" })).toBeTruthy();
    expect(isDuplicate(recent, { text: "same", link: "https://y.example" })).toBeNull();
    expect(isDuplicate(recent, { text: "other", link: "https://x.example/a" })).toBeNull();
  });
  it("clips card title and description on grapheme boundaries", () => {
    const flag = "\u{1F1E6}\u{1F1F9}";
    const umlaut = "u\u0308";
    const { embed } = buildRecord({ text: "t", createdAt: "x", link: "https://x.example", title: "a".repeat(150) + flag.repeat(60), description: umlaut.repeat(360) });
    expect(countGraphemes(embed.external.title)).toBe(200);
    expect(embed.external.title.endsWith(flag + "…")).toBe(true);
    expect(embed.external.description).toBe(umlaut.repeat(299) + "…");
  });
});

describe("profile", () => {
  it("parses and merges without losing avatar or banner", () => {
    const p = parseProfile("---\ndisplayName: Daniel\n---\nBio line\n");
    expect(p).toEqual({ displayName: "Daniel", description: "Bio line", avatar: undefined });
    expect(mergeProfile({ avatar: { ref: 1 }, banner: { ref: 2 }, displayName: "Old" }, p)).toEqual({
      $type: "app.bsky.actor.profile", avatar: { ref: 1 }, banner: { ref: 2 }, displayName: "Daniel", description: "Bio line",
    });
    expect(() => parseProfile(`---\ndisplayName: x\n---\n${"a".repeat(257)}`)).toThrow(/limit is 256/);
  });
});
