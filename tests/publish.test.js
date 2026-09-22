import { describe, expect, it } from "vitest";
import { publish } from "../src/publish.js";
import { loadConfig, credentials } from "../src/config.js";
import { createNullGit } from "../src/git.js";
import { createRecordingFetch } from "../src/dryrun.js";
import { readState, resourceFetch, tempRepo, writeState } from "./helpers.js";

const FILE = "posts/2026-09-29-example.md";
const AT = "2026-09-29T08:30:00+02:00";
const DUE = Date.parse("2026-09-29T06:31:00Z");
const env = { LINKEDIN_ACCESS_TOKEN: "t", BLUESKY_HANDLE: "h.example", BLUESKY_APP_PASSWORD: "p" };

async function run(dir, { nowMs = DUE, apiFetch, git = createNullGit(), notifications = [] } = {}) {
  const recorder = createRecordingFetch();
  const summary = await publish({
    cwd: dir,
    config: await loadConfig(dir),
    creds: credentials(env),
    nowMs,
    git,
    notify: async (n) => { notifications.push(n); },
    fetch: apiFetch ?? recorder.fetch,
    fetchResource: resourceFetch,
    log: () => {},
  });
  return { summary, requests: recorder.requests, notifications };
}

describe("publish", () => {
  it("does nothing before the post is due", async () => {
    const dir = await tempRepo();
    const git = createNullGit();
    const { summary } = await run(dir, { nowMs: DUE - 3_600_000, git });
    expect(summary.candidates).toBe(0);
    expect(git.calls).toEqual([]);
    expect(await readState(dir)).toEqual([]);
  });

  it("publishes both channels with intent and published lines and the exact requests", async () => {
    const dir = await tempRepo();
    const git = createNullGit();
    const notifications = [];
    const { summary, requests } = await run(dir, { git, notifications });
    expect(summary.published.map((p) => p.channel).sort()).toEqual(["bluesky", "linkedin"]);
    expect(summary.failed).toEqual([]);

    const state = await readState(dir);
    expect(state.map((e) => `${e.channel}:${e.status}`)).toEqual(["linkedin:intent", "linkedin:published", "bluesky:intent", "bluesky:published"]);
    expect(state[1]).toMatchObject({ file: FILE, at: AT, id: "urn:li:share:DRYRUN", url: "https://www.linkedin.com/feed/update/urn:li:share:DRYRUN/" });
    expect(state[3]).toMatchObject({ id: "at://did:plc:dryrun/app.bsky.feed.post/dryrun", url: "https://bsky.app/profile/dryrun.invalid/post/dryrun" });

    expect(git.calls[0]).toEqual(["preflight"]);
    expect(git.calls.slice(1).map((c) => c[2])).toEqual([`intent: linkedin ${FILE}`, `published: linkedin ${FILE}`, `intent: bluesky ${FILE}`, `published: bluesky ${FILE}`]);
    expect(notifications.map((n) => n.title)).toEqual(["Posted on linkedin", "Posted on bluesky"]);

    const stripped = requests.map((r) => ({ ...r, body: r.body && typeof r.body === "object" && r.body.record ? { ...r.body, record: { ...r.body.record, createdAt: "<now>" } } : r.body }));
    expect(stripped).toMatchSnapshot();
  });

  it("skips posts that are overdue beyond the window", async () => {
    const dir = await tempRepo();
    const { summary, notifications } = await run(dir, { nowMs: DUE + 13 * 3_600_000 });
    expect(summary.skipped).toHaveLength(2);
    expect((await readState(dir)).every((e) => e.status === "skipped" && e.at === AT)).toBe(true);
    expect(notifications[0].title).toBe("postkasten: post skipped");
  });

  it("records a failure, keeps the other channel going and gives up after three", async () => {
    const dir = await tempRepo();
    const { fetch: good } = createRecordingFetch();
    const apiFetch = async (url, init) => (String(url).includes("/rest/posts") ? new Response('{"message":"rate"}', { status: 429 }) : good(url, init));
    const { summary, notifications } = await run(dir, { apiFetch });
    expect(summary.failed).toEqual([{ file: FILE, channel: "linkedin", error: expect.stringMatching(/429/) }]);
    expect(summary.published.map((p) => p.channel)).toEqual(["bluesky"]);
    expect(notifications[0].title).toBe("postkasten: linkedin failed (1/3)");

    await writeState(dir, [1, 2, 3].map((i) => ({ file: FILE, channel: "linkedin", status: "failed", at: AT, ts: `2026-09-29T06:3${i}:00Z` })));
    const second = await run(dir, { apiFetch });
    expect(second.summary.givenUp).toEqual([{ file: FILE, channel: "linkedin" }]);
    expect(second.summary.candidates).toBe(1);
  });

  it("never posts over an open intent and reports it", async () => {
    const dir = await tempRepo();
    await writeState(dir, [{ file: FILE, channel: "linkedin", status: "intent", at: AT, ts: "2026-09-29T06:30:30Z" }]);
    const { summary, notifications } = await run(dir);
    expect(summary.blocked).toEqual([{ file: FILE, channel: "linkedin" }]);
    expect(summary.published.map((p) => p.channel)).toEqual(["bluesky"]);
    expect(notifications[0].title).toBe("postkasten: open intent");
  });

  it("treats a post already on Bluesky as published without posting again", async () => {
    const dir = await tempRepo();
    const { fetch: good } = createRecordingFetch();
    const apiFetch = async (url, init) =>
      String(url).includes("getAuthorFeed")
        ? Response.json({ feed: [{ post: { author: { did: "did:plc:dryrun" }, uri: "at://did:plc:dryrun/app.bsky.feed.post/old", record: { text: "x" }, embed: { external: { uri: "https://pushingpixels.at/portfolio/zero-downtime-migrations" } } } }] })
        : good(url, init);
    const { summary } = await run(dir, { apiFetch });
    const bsky = summary.published.find((p) => p.channel === "bluesky");
    expect(bsky).toMatchObject({ duplicate: true, id: "at://did:plc:dryrun/app.bsky.feed.post/old" });
  });

  it("leaves a disabled channel pending without touching the state", async () => {
    const dir = await tempRepo();
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(dir, "postkasten.config.json"), JSON.stringify({ channels: ["bluesky"] }));
    const { summary } = await run(dir);
    expect(summary.disabled).toEqual([{ file: FILE, channel: "linkedin" }]);
    expect(summary.published.map((p) => p.channel)).toEqual(["bluesky"]);
    expect((await readState(dir)).map((e) => `${e.channel}:${e.status}`)).toEqual(["bluesky:intent", "bluesky:published"]);
  });

  it("stops before posting when git preflight fails", async () => {
    const dir = await tempRepo();
    const git = { ...createNullGit(), preflight: async () => { throw new Error("git push failed: rejected"); } };
    await expect(run(dir, { git })).rejects.toThrow(/rejected/);
    expect(await readState(dir)).toEqual([]);
  });
});
