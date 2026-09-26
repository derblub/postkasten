import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { credentials, linkedinVersion } from "../src/config.js";
import { createRecordingFetch } from "../src/dryrun.js";
import { expiryWarning } from "../src/cli/doctor.js";
import { imageType } from "../src/cli/bluesky.js";

const BIN = fileURLToPath(new URL("../bin/postkasten.js", import.meta.url));
const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

describe("credentials", () => {
  it("treats empty and blank values as unset", () => {
    const c = credentials({ LINKEDIN_ACCESS_TOKEN: "", LINKEDIN_VERSION: "", BLUESKY_HANDLE: "  ", NTFY_SERVER: "", NTFY_TOPIC: "t" });
    expect(c.linkedin.token).toBeUndefined();
    expect(c.linkedin.version).toBeUndefined();
    expect(c.bluesky.handle).toBeUndefined();
    expect(c.ntfyServer).toBe("https://ntfy.sh");
    expect(c.ntfyTopic).toBe("t");
  });

  it("rejects a malformed LINKEDIN_VERSION only where it is used", () => {
    const config = { linkedinVersion: "202601" };
    expect(linkedinVersion(credentials({ LINKEDIN_VERSION: "202609" }), config)).toBe("202609");
    expect(linkedinVersion(credentials({}), config)).toBe("202601");
    const bad = credentials({ LINKEDIN_VERSION: "2026-09" });
    expect(bad.linkedin.version).toBe("2026-09");
    expect(() => linkedinVersion(bad, config)).toThrow(/LINKEDIN_VERSION must be YYYYMM/);
  });
});

describe("dry-run recorder", () => {
  it("redacts secrets in headers, JSON and form bodies", async () => {
    const { fetch, requests } = createRecordingFetch();
    await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { Authorization: "Bearer real" },
      body: JSON.stringify({ identifier: "h.example", password: "secret-pass" }),
    });
    await fetch("https://www.linkedin.com/oauth/v2/introspectToken", {
      method: "POST",
      body: new URLSearchParams({ client_id: "id", client_secret: "cs", token: "tok" }),
    });
    const printed = JSON.stringify(requests);
    for (const s of ["real", "secret-pass", "\"cs\"", "tok\""]) expect(printed).not.toContain(s);
    expect(requests[0].body).toEqual({ identifier: "h.example", password: "***" });
    expect(requests[1].body).toEqual({ client_id: "id", client_secret: "***", token: "***" });
  });
});

describe("doctor expiryWarning", () => {
  it("warns once at 14, 7, 3 and 1 days, urgent from 3", () => {
    const fired = [];
    for (let d = 20; d >= 1; d--) if (expiryWarning(d - 0.5)) fired.push(d);
    expect(fired).toEqual([14, 7, 3, 1]);
    expect(expiryWarning(13.5)).toEqual({ days: 14, priority: "high" });
    expect(expiryWarning(6.2)).toEqual({ days: 7, priority: "high" });
    expect(expiryWarning(2.5)).toEqual({ days: 3, priority: "urgent" });
    expect(expiryWarning(0.3)).toEqual({ days: 1, priority: "urgent" });
    expect(expiryWarning(-0.1)).toEqual({ days: 0, priority: "urgent" });
    expect(expiryWarning(5)).toBeNull();
  });
});

describe("bluesky avatar type", () => {
  it("detects png and jpeg case-insensitively and rejects others", () => {
    expect(imageType("Avatar.PNG")).toBe("image/png");
    expect(imageType("a.jpeg")).toBe("image/jpeg");
    expect(imageType("a.JPG")).toBe("image/jpeg");
    expect(() => imageType("a.webp")).toThrow(/png, .jpg or .jpeg/);
  });
});

describe("bin", () => {
  it("reports unknown options as a one-line error", async () => {
    const err = await promisify(execFile)(process.execPath, [BIN, "publish", "--dryrun"]).catch((e) => e);
    expect(err.code).toBe(1);
    expect(err.stderr).toMatch(/^Unknown option '--dryrun'/);
    expect(err.stderr).toContain("postkasten --help");
    expect(err.stderr).not.toMatch(/\n\s+at /);
  });
});

describe("examples", () => {
  it("pin the current version", async () => {
    const { version } = JSON.parse(await readFile(root("package.json"), "utf8"));
    const example = JSON.parse(await readFile(root("examples/content-repo/package.json"), "utf8"));
    expect(example.dependencies.postkasten).toBe(`github:derblub/postkasten#v${version}`);
    expect(await readFile(root("README.md"), "utf8")).toContain(`npm install github:derblub/postkasten#v${version}`);
  });

  it("do not use npm ci without a lockfile", async () => {
    for (const f of ["examples/content-repo/.gitlab-ci.yml", "examples/github-actions/publish.yml"]) {
      expect(await readFile(root(f), "utf8")).not.toMatch(/npm ci\b/);
    }
  });
});
