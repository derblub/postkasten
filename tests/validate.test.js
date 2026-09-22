import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validate } from "../src/validate.js";
import { loadConfig } from "../src/config.js";
import { resourceFetch, tempRepo, writeState } from "./helpers.js";

describe("validate", () => {
  it("accepts the example repo online and offline", async () => {
    const dir = await tempRepo();
    const config = await loadConfig(dir);
    expect((await validate({ cwd: dir, config, online: false })).ok).toBe(true);
    const online = await validate({ cwd: dir, config, online: true, fetch: resourceFetch });
    expect(online.ok).toBe(true);
    expect(online.problems).toEqual([]);
  });

  it("reports wrong offsets, rule violations, lengths and orphans", async () => {
    const dir = await tempRepo();
    await writeFile(join(dir, "posts/2026-11-10-bad.md"), `---
at: 2026-11-10T08:30:00+02:00
linkedin:
  link: https://pushingpixels.at/de/x?utm_source=a
bluesky:
  link: https://pushingpixels.at/x
---
## linkedin
Dive into this — pushingpixels.at/de/x

## bluesky
${"a".repeat(301)} https://pushingpixels.at/x
`);
    await writeFile(join(dir, "posts/2026-11-11-broken.md"), "---\nat: tomorrow\n---\n## linkedin\nx\n");
    await writeState(dir, [{ file: "posts/gone.md", channel: "linkedin", status: "published", ts: "2026-01-01T00:00:00Z" }]);
    const { ok, problems } = await validate({ cwd: dir, config: await loadConfig(dir), online: false });
    expect(ok).toBe(false);
    const messages = problems.map((p) => `${p.level}:${p.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/error:`at` has offset \+02:00, but Europe\/Vienna is \+01:00/),
      "error:linkedin: text contains em dash (U+2014)",
      'error:linkedin: text contains "dive into"',
      "error:linkedin.link carries utm_ parameters",
      "warning:linkedin: a link without https:// is not reliably clickable",
      "error:bluesky: 328 graphemes, limit is 300",
      "warning:bluesky: text contains a URL although the link card already carries the link",
      expect.stringMatching(/error:`at` must look like/),
      expect.stringMatching(/warning:state has a `published` line for a file that no longer exists/),
    ]));
  });
});
