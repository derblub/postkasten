import { describe, expect, it } from "vitest";
import { createLinkedIn, introspectToken, postUrl } from "../src/linkedin/client.js";
import { buildPost } from "../src/linkedin/posts.js";
import { authorizationUrl } from "../src/linkedin/auth.js";

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

describe("createLinkedIn", () => {
  it("sends the versioned headers and reads userinfo", async () => {
    const f = fakeFetch([["/v2/userinfo", () => Response.json({ sub: "abc" })]]);
    const li = createLinkedIn({ fetch: f, token: "t", version: "202609" });
    expect(await li.userinfo()).toEqual({ sub: "abc", personUrn: "urn:li:person:abc" });
    expect(f.calls[0].init.headers).toMatchObject({ authorization: "Bearer t", "linkedin-version": "202609", "x-restli-protocol-version": "2.0.0" });
  });
  it("uploads an image in two steps and returns the URN", async () => {
    const f = fakeFetch([
      ["initializeUpload", () => Response.json({ value: { uploadUrl: "https://up.example/1", image: "urn:li:image:1" } })],
      ["up.example", () => new Response("", { status: 201 })],
    ]);
    const li = createLinkedIn({ fetch: f, token: "t", version: "202609" });
    expect(await li.uploadImage("urn:li:person:abc", new Uint8Array(3), "image/png")).toBe("urn:li:image:1");
    expect(f.calls[1].init.method).toBe("PUT");
    expect(f.calls[1].init.headers["content-type"]).toBe("image/png");
  });
  it("returns the post URN from x-restli-id and surfaces API errors", async () => {
    const f = fakeFetch([
      ["/rest/posts", (init) => (init.method === "POST" ? new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:9" } }) : new Response(null, { status: 204 }))],
    ]);
    const li = createLinkedIn({ fetch: f, token: "t", version: "202609" });
    expect(await li.createPost({})).toBe("urn:li:share:9");
    await li.deletePost("urn:li:share:9");
    expect(f.calls[1].url).toContain("urn%3Ali%3Ashare%3A9");

    const bad = createLinkedIn({ fetch: fakeFetch([["/rest/posts", () => new Response('{"message":"expired"}', { status: 401 })]]), token: "t", version: "202609" });
    await expect(bad.createPost({})).rejects.toThrow(/LinkedIn POST \/rest\/posts returned 401: {"message":"expired"}/);
  });
  it("refuses to start without a token or with a bad version", () => {
    expect(() => createLinkedIn({ token: "", version: "202609" })).toThrow(/LINKEDIN_ACCESS_TOKEN/);
    expect(() => createLinkedIn({ token: "t", version: "2026-09" })).toThrow(/YYYYMM/);
  });
});

describe("buildPost", () => {
  it("escapes commentary and attaches the article card", () => {
    const post = buildPost({ authorUrn: "urn:li:person:a", text: "Hi (you) #Django", link: "https://x.example/p", title: "T", description: "D", thumbnail: "urn:li:image:1" });
    expect(post).toEqual({
      author: "urn:li:person:a",
      commentary: "Hi \\(you\\) #Django",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      content: { article: { source: "https://x.example/p", title: "T", description: "D", thumbnail: "urn:li:image:1" } },
    });
    expect(buildPost({ authorUrn: "u", text: "t", visibility: "CONNECTIONS" })).not.toHaveProperty("content");
    expect(() => buildPost({ authorUrn: "u", text: "(".repeat(1501) })).toThrow(/limit is 3000/);
  });
  it("clips card text without splitting surrogate pairs or clusters", () => {
    const { title, description } = buildPost({ authorUrn: "u", text: "t", link: "https://x.example", title: "a".repeat(198) + "😀😀", description: "b".repeat(297) + "👨‍👩‍👧" }).content.article;
    expect(title).toBe("a".repeat(198) + "…");
    expect(title.isWellFormed()).toBe(true);
    expect(description).toBe("b".repeat(297) + "…");
  });
});

describe("auth and introspection", () => {
  it("builds the authorization URL with the three scopes", () => {
    const url = new URL(authorizationUrl({ clientId: "cid", state: "s" }));
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8787/callback");
  });
  it("posts form data to introspectToken", async () => {
    const f = fakeFetch([["introspectToken", () => Response.json({ active: true, expires_at: 1 })]]);
    expect(await introspectToken({ clientId: "c", clientSecret: "s", token: "t", fetch: f })).toEqual({ active: true, expires_at: 1 });
    expect(String(f.calls[0].init.body)).toBe("client_id=c&client_secret=s&token=t");
  });
  it("formats post URLs", () => {
    expect(postUrl("urn:li:share:1")).toBe("https://www.linkedin.com/feed/update/urn:li:share:1/");
    expect(postUrl(null)).toBeNull();
  });
});
