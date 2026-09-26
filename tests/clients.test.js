import { describe, expect, it } from "vitest";
import { createBluesky } from "../src/bluesky/client.js";
import { createLinkedIn, introspectToken } from "../src/linkedin/client.js";
import { exchangeCode } from "../src/linkedin/auth.js";
import { createNotifier } from "../src/notify.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function bluesky(getRecord) {
  const signals = [];
  const fetch = async (url, init) => {
    signals.push(init?.signal);
    if (url.includes("createSession")) return json(200, { did: "did:plc:me", handle: "me.test", accessJwt: "a" });
    return getRecord();
  };
  return { bsky: createBluesky({ fetch }), signals };
}

describe("bluesky getProfileRecord", () => {
  it("returns null only for a missing record", async () => {
    for (const body of [{ error: "RecordNotFound", message: "Could not locate record" }, { error: "InvalidRequest", message: "Could not locate record: at://x" }]) {
      const { bsky } = bluesky(() => json(400, body));
      await bsky.login("me.test", "pw");
      expect(await bsky.getProfileRecord()).toBeNull();
    }
  });
  it("rethrows other 400s with their status", async () => {
    const { bsky } = bluesky(() => json(400, { error: "ExpiredToken", message: "Token has expired" }));
    await bsky.login("me.test", "pw");
    await expect(bsky.getProfileRecord()).rejects.toMatchObject({ status: 400, detail: expect.stringContaining("ExpiredToken") });
  });
  it("passes a timeout signal", async () => {
    const { bsky, signals } = bluesky(() => json(200, { value: {} }));
    await bsky.login("me.test", "pw");
    await bsky.getProfileRecord();
    expect(signals.length).toBe(2);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});

describe("timeouts", () => {
  it("every LinkedIn, OAuth and ntfy request carries an AbortSignal", async () => {
    const signals = [];
    const fetch = async (url, init) => {
      signals.push(init?.signal);
      if (url.includes("initializeUpload")) return json(200, { value: { uploadUrl: "https://up.example/x", image: "urn:li:image:1" } });
      if (url.includes("accessToken")) return json(200, { access_token: "t", expires_in: 60 });
      if (url.includes("introspectToken")) return json(200, { active: true });
      return new Response("", { status: 201 });
    };
    const li = createLinkedIn({ fetch, token: "t", version: "202601" });
    await li.uploadImage("urn:li:person:1", new Uint8Array(1), "image/png");
    await introspectToken({ clientId: "c", clientSecret: "s", token: "t", fetch });
    await exchangeCode({ code: "c", clientId: "c", clientSecret: "s", fetch });
    await createNotifier({ topic: "t", fetch })({ title: "x", message: "y" });
    expect(signals.length).toBe(5);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});
