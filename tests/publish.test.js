import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publish } from "../src/publish.js";
import { loadConfig, credentials } from "../src/config.js";
import { createGit, createNullGit } from "../src/git.js";
import { createRecordingFetch } from "../src/dryrun.js";
import { resolveStatus } from "../src/state.js";
import { git as sh, gitRepo, readState, resourceFetch, tempRepo, writeState } from "./helpers.js";

const FILE = "posts/2026-09-29-example.md";
const AT = "2026-09-29T08:30:00+02:00";
const DUE = Date.parse("2026-09-29T06:31:00Z");
const env = { LINKEDIN_ACCESS_TOKEN: "t", BLUESKY_HANDLE: "h.example", BLUESKY_APP_PASSWORD: "p" };

async function run(dir, { nowMs = DUE, apiFetch, git = createNullGit(), notifications = [], creds = env, fetchResource = resourceFetch } = {}) {
  const recorder = createRecordingFetch();
  const summary = await publish({
    cwd: dir,
    config: await loadConfig(dir),
    creds: credentials(creds),
    nowMs,
    git,
    notify: async (n) => { notifications.push(n); },
    fetch: apiFetch ?? recorder.fetch,
    fetchResource,
    log: () => {},
  });
  return { summary, requests: recorder.requests, notifications };
}

/** The recording fetch, with `override(url, init)` answering first when it returns a Response. */
function fakeApi(override) {
  const recorder = createRecordingFetch();
  const fetch = async (url, init) => (await override(String(url), init)) ?? recorder.fetch(url, init);
  return { fetch, requests: recorder.requests };
}

function countingResources() {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push(String(url)); return resourceFetch(url, init); } };
}

const lines = async (dir, channel) => (await readState(dir)).filter((e) => !channel || e.channel === channel).map((e) => `${e.channel}:${e.status}`);


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
    const apiFetch = async (url, init) => (String(url).includes("/rest/posts") ? new Response('{"message":"bad"}', { status: 422 }) : good(url, init));
    const { summary, notifications } = await run(dir, { apiFetch });
    expect(summary.failed).toEqual([{ file: FILE, channel: "linkedin", error: expect.stringMatching(/422/) }]);
    expect(await lines(dir, "linkedin")).toEqual(["linkedin:intent", "linkedin:failed"]);
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
    const { posts } = await (await import("../src/queue.js")).loadQueue(dir, "posts");
    const text = posts[0].channels.bluesky.text;
    const apiFetch = async (url, init) =>
      String(url).includes("getAuthorFeed")
        ? Response.json({ feed: [{ post: { author: { did: "did:plc:dryrun" }, uri: "at://did:plc:dryrun/app.bsky.feed.post/old", record: { text }, embed: { external: { uri: "https://pushingpixels.at/portfolio/zero-downtime-migrations" } } } }] })
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

  it.each([
    ["a 502", () => new Response("bad gateway", { status: 502 })],
    ["a 429", () => new Response("slow down", { status: 429 })],
    ["a network error", () => { throw new TypeError("fetch failed"); }],
    ["a 201 without id", () => new Response("", { status: 201 })],
  ])("leaves the intent open when LinkedIn's create answers with %s", async (_, answer) => {
    const dir = await tempRepo();
    const api = fakeApi((url, init) => (url.includes("/rest/posts") && init.method === "POST" ? answer() : undefined));
    const { summary, notifications } = await run(dir, { apiFetch: api.fetch });
    expect(summary.failed).toEqual([{ file: FILE, channel: "linkedin", error: expect.any(String), note: "outcome unknown, intent left open" }]);
    expect(summary.published.map((p) => p.channel)).toEqual(["bluesky"]);
    expect(await lines(dir, "linkedin")).toEqual(["linkedin:intent"]);
    expect(notifications[0]).toMatchObject({ title: "postkasten: linkedin outcome unknown", message: expect.stringContaining(`postkasten resolve ${FILE} linkedin`) });

    const again = fakeApi(() => undefined);
    const second = await run(dir, { apiFetch: again.fetch });
    expect(second.summary.blocked).toEqual([{ file: FILE, channel: "linkedin" }]);
    expect(again.requests.some((r) => r.url.includes("/rest/posts"))).toBe(false);
  });

  it("leaves the intent open when Bluesky's createRecord fails ambiguously, records a definite rejection", async () => {
    const dir = await tempRepo();
    const api = fakeApi((url) => (url.includes("createRecord") ? new Response("oops", { status: 500 }) : undefined));
    const { summary } = await run(dir, { apiFetch: api.fetch });
    expect(summary.failed).toMatchObject([{ channel: "bluesky", note: "outcome unknown, intent left open" }]);
    expect(await lines(dir, "bluesky")).toEqual(["bluesky:intent"]);

    const dir2 = await tempRepo();
    const rejected = fakeApi((url) => (url.includes("createRecord") ? new Response('{"error":"InvalidRequest"}', { status: 400 }) : undefined));
    await run(dir2, { apiFetch: rejected.fetch });
    expect(await lines(dir2, "bluesky")).toEqual(["bluesky:intent", "bluesky:failed"]);
  });

  it("fails without an intent when credentials or the link are the problem", async () => {
    const dir = await tempRepo();
    const { summary, notifications } = await run(dir, { creds: { ...env, LINKEDIN_ACCESS_TOKEN: undefined } });
    expect(summary.failed).toEqual([{ file: FILE, channel: "linkedin", error: expect.stringMatching(/access token is missing/) }]);
    expect(await lines(dir, "linkedin")).toEqual(["linkedin:failed"]);
    expect(notifications[0].title).toBe("postkasten: linkedin failed (1/3)");

    const dir2 = await tempRepo();
    await run(dir2, { fetchResource: async () => new Response("", { status: 404 }) });
    expect(await lines(dir2)).toEqual(["linkedin:failed", "bluesky:failed"]);
  });

  it("logs in once per channel and fetches each page and image once per run", async () => {
    const dir = await tempRepo();
    const source = await readFile(join(dir, FILE), "utf8");
    await writeFile(join(dir, "posts/2026-09-29-second.md"), source.replace(/^(Jede|Every) /gm, "Again: $1 "));
    const resources = countingResources();
    const api = fakeApi(() => undefined);
    const { summary } = await run(dir, { apiFetch: api.fetch, fetchResource: resources.fetch });
    expect(summary.published).toHaveLength(4);
    expect(api.requests.filter((r) => r.url.includes("/v2/userinfo"))).toHaveLength(1);
    expect(api.requests.filter((r) => r.url.includes("createSession"))).toHaveLength(1);
    expect(new Set(resources.calls).size).toBe(resources.calls.length);
  });

  it("does not fetch the link when title, description and image are all set", async () => {
    const dir = await tempRepo();
    const source = await readFile(join(dir, FILE), "utf8");
    await writeFile(join(dir, FILE), source.replace("  link: https://pushingpixels.at/de/portfolio/zero-downtime-migrations\n", "  link: https://pushingpixels.at/de/portfolio/zero-downtime-migrations\n  title: T\n  description: D\n  image: https://pushingpixels.at/og/x.png\n"));
    const resources = countingResources();
    const { summary } = await run(dir, { fetchResource: resources.fetch });
    expect(summary.published).toHaveLength(2);
    expect(resources.calls.filter((u) => u.includes("/de/portfolio/"))).toEqual([]);
  });

  it("stops with 'state lost' and no failed line when the published line cannot be pushed", async () => {
    const dir = await tempRepo();
    const base = createNullGit();
    const git = { ...base, commitAndPush: async (paths, message) => { if (message.startsWith("published: linkedin")) throw new Error("git push failed: rejected"); return base.commitAndPush(paths, message); } };
    const notifications = [];
    await expect(run(dir, { git, notifications })).rejects.toThrow(/rejected/);
    expect(await lines(dir, "linkedin")).toEqual(["linkedin:intent", "linkedin:published"]);
    expect(notifications.map((n) => n.title)).toEqual(["postkasten: state lost"]);
    expect(notifications[0].message).toContain(`postkasten resolve ${FILE} linkedin --published urn:li:share:DRYRUN`);
  });

  it("notifies once about due posts that are invalid, not about future ones", async () => {
    const dir = await tempRepo();
    await appendFile(join(dir, "rules/forbidden.txt"), "\nZero-downtime\n");
    const git = createNullGit();
    const { summary, notifications } = await run(dir, { git });
    expect(summary.invalidDue).toEqual([FILE]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ title: "postkasten: due post is invalid", message: expect.stringContaining(`${FILE}: `) });
    expect(git.calls).toEqual([["preflight"]]);

    const early = await run(dir, { nowMs: DUE - 3_600_000 });
    expect(early.summary.invalid).toEqual([FILE]);
    expect(early.summary.invalidDue).toEqual([]);
    expect(early.notifications).toEqual([]);

    const late = await run(dir, { nowMs: DUE + 13 * 3_600_000 });
    expect(late.summary.invalid).toEqual([FILE]);
    expect(late.summary.invalidDue).toEqual([]);
    expect(late.notifications).toEqual([]);
  });
});

describe("publish with real git", () => {
  const user = { name: "postkasten", email: "postkasten@localhost" };

  it("re-reads the state after preflight, so a stale checkout does not post again", async () => {
    const { clone } = await gitRepo();
    const dir = clone("runner");
    const stale = sh(dir, "rev-parse", "HEAD");
    await writeState(dir, ["linkedin", "bluesky"].flatMap((channel) => [
      { file: FILE, channel, status: "intent", at: AT, ts: "2026-09-29T06:30:10Z" },
      { file: FILE, channel, status: "published", at: AT, id: `${channel}-id`, ts: "2026-09-29T06:30:20Z" },
    ]));
    sh(dir, "commit", "-qam", "published");
    sh(dir, "push", "-q", "origin", "main");
    sh(dir, "checkout", "-q", "--detach", stale);

    const api = fakeApi(() => undefined);
    const { summary } = await run(dir, { git: createGit({ cwd: dir, user }), apiFetch: api.fetch });
    expect(summary.candidates).toBe(0);
    expect(summary.published).toEqual([]);
    expect(api.requests).toEqual([]);
    expect(await lines(dir)).toEqual(["linkedin:intent", "linkedin:published", "bluesky:intent", "bluesky:published"]);
  });

  it("does not report an intent that origin already resolved", async () => {
    const { clone } = await gitRepo();
    const dir = clone("runner");
    await writeState(dir, [{ file: FILE, channel: "linkedin", status: "intent", at: AT, ts: "2026-09-29T06:30:10Z" }]);
    sh(dir, "commit", "-qam", "intent");
    sh(dir, "push", "-q", "origin", "main");
    const stale = sh(dir, "rev-parse", "HEAD");
    await appendFile(join(dir, "state/published.jsonl"), JSON.stringify({ file: FILE, channel: "linkedin", status: "published", at: AT, id: "li-id", ts: "2026-09-29T06:30:20Z" }) + "\n");
    sh(dir, "commit", "-qam", "published");
    sh(dir, "push", "-q", "origin", "main");
    sh(dir, "checkout", "-q", "--detach", stale);

    const api = fakeApi(() => undefined);
    const { summary, notifications } = await run(dir, { git: createGit({ cwd: dir, user }), apiFetch: api.fetch, creds: { LINKEDIN_ACCESS_TOKEN: "t" } });
    expect(summary.blocked).toEqual([]);
    expect(notifications.map((n) => n.title)).not.toContain("postkasten: open intent");
  });

  it("does not post when a concurrent run pushed an intent for the same post first", async () => {
    const { clone } = await gitRepo();
    const dir = clone("runner");
    const other = clone("other");
    const real = createGit({ cwd: dir, user });
    const git = {
      ...real,
      async preflight() {
        await real.preflight();
        await writeState(other, [{ file: FILE, channel: "linkedin", status: "intent", at: AT, ts: "2026-09-29T06:30:05Z" }]);
        sh(other, "commit", "-qam", "intent from run A");
        sh(other, "push", "-q", "origin", "main");
      },
    };
    const api = fakeApi(() => undefined);
    const notifications = [];
    await expect(run(dir, { git, apiFetch: api.fetch, notifications })).rejects.toThrow(/linkedin is blocked on origin/);
    expect(api.requests.filter((r) => r.url.includes("/rest/posts"))).toEqual([]);
    expect(notifications.map((n) => n.title)).toEqual(["postkasten: cannot push state"]);
    expect(existsSync(join(dir, ".git/rebase-merge"))).toBe(false);
    expect(await lines(clone("check"))).toEqual(["linkedin:intent"]);
  });

  it("publishes and pushes every line to origin", async () => {
    const { clone } = await gitRepo();
    const dir = clone("runner");
    const { summary } = await run(dir, { git: createGit({ cwd: dir, user }) });
    expect(summary.published).toHaveLength(2);
    const check = clone("check");
    expect(await lines(check)).toEqual(["linkedin:intent", "linkedin:published", "bluesky:intent", "bluesky:published"]);
  });

  it("re-applies an append on top of a concurrent state push instead of leaving a rebase behind", async () => {
    const { clone } = await gitRepo();
    const runner = clone("runner");
    const other = clone("other");
    const g = createGit({ cwd: runner, user });
    await g.preflight();

    await appendFile(join(other, "state/published.jsonl"), '{"other":1}\n');
    sh(other, "commit", "-qam", "other");
    sh(other, "push", "-q", "origin", "main");

    const append = () => appendFile(join(runner, "state/published.jsonl"), '{"ours":1}\n');
    await append();
    expect(await g.commitAndPush(["state/published.jsonl"], "ours", append)).toBe(true);
    expect(existsSync(join(runner, ".git/rebase-merge"))).toBe(false);
    sh(other, "pull", "-q", "origin", "main");
    expect(await readFile(join(other, "state/published.jsonl"), "utf8")).toBe('{"other":1}\n{"ours":1}\n');

    await appendFile(join(other, "state/published.jsonl"), '{"other":2}\n');
    sh(other, "commit", "-qam", "other 2");
    sh(other, "push", "-q", "origin", "main");
    await appendFile(join(runner, "state/published.jsonl"), '{"ours":2}\n');
    await expect(g.commitAndPush(["state/published.jsonl"], "no reapply")).rejects.toThrow(/rebase failed/);
    expect(existsSync(join(runner, ".git/rebase-merge"))).toBe(false);
    expect(sh(runner, "status", "--porcelain")).toBe("");

    await appendFile(join(other, "state/published.jsonl"), '{"other":3}\n');
    sh(other, "commit", "-qam", "other 3");
    sh(other, "push", "-q", "origin", "main");
    await appendFile(join(runner, "state/published.jsonl"), '{"ours":3}\n');
    await expect(g.commitAndPush(["state/published.jsonl"], "refused", async () => { throw new Error("no longer applies"); })).rejects.toThrow(/no longer applies/);
    expect(sh(runner, "status", "--porcelain")).toBe("");
    expect(await readFile(join(runner, "state/published.jsonl"), "utf8")).not.toContain("ours\":3");
  });

  it("preflight fails when the remote refuses the push options real pushes use", async () => {
    const { clone } = await gitRepo({ pushOptions: false });
    const dir = clone("runner");
    await expect(createGit({ cwd: dir, user }).preflight()).rejects.toThrow(/push options/);
  });
});
