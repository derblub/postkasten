import { describe, expect, it } from "vitest";
import { countGraphemes, truncateCodeUnits, truncateGraphemes } from "../src/text/graphemes.js";
import { buildFacets, findHashtags, findUrls } from "../src/text/facets.js";
import { escapeLittle } from "../src/text/linkedin-escape.js";
import { checkRules, parseRules } from "../src/text/rules.js";

describe("graphemes", () => {
  it("counts clusters, not code units", () => {
    expect(countGraphemes("ä€🚀")).toBe(3);
    expect(countGraphemes("👨‍👩‍👧")).toBe(1);
    expect("👨‍👩‍👧".length).toBe(8);
    expect(truncateGraphemes("abc🚀def", 4)).toBe("abc🚀");
    expect(truncateCodeUnits("ab🚀c", 3)).toBe("ab");
    expect(truncateCodeUnits("ab🚀c", 4)).toBe("ab🚀");
  });
});

describe("facets", () => {
  it("uses UTF-8 byte offsets after umlauts, euro and emoji", () => {
    const text = "Zähler € 🚀 https://pushingpixels.at/x, #Django and #2026 no";
    const facets = buildFacets(text);
    const link = facets.find((f) => f.features[0].$type === "app.bsky.richtext.facet#link");
    const start = Buffer.byteLength("Zähler € 🚀 ");
    expect(link.index).toEqual({ byteStart: start, byteEnd: start + "https://pushingpixels.at/x".length });
    expect(link.features[0].uri).toBe("https://pushingpixels.at/x");
    const tags = facets.filter((f) => f.features[0].$type === "app.bsky.richtext.facet#tag");
    expect(tags.map((t) => t.features[0].tag)).toEqual(["Django"]);
    expect(Buffer.from(text).subarray(tags[0].index.byteStart, tags[0].index.byteEnd).toString()).toBe("#Django");
  });
  it("trims trailing punctuation and ignores tags inside words", () => {
    expect(findUrls("see (https://a.example/p).").map((u) => u.url)).toEqual(["https://a.example/p"]);
    expect(findHashtags("a#b #c! #d").map((t) => t.tag)).toEqual(["c", "d"]);
  });
  it("strips Unicode punctuation and keeps balanced parentheses in URLs", () => {
    expect(findUrls("„https://x.at/y“ und https://z.at/a… und https://x.org/").map((u) => u.url)).toEqual(["https://x.at/y", "https://z.at/a", "https://x.org/"]);
    expect(findUrls("Siehe https://de.wikipedia.org/wiki/Foo_(Bar) jetzt").map((u) => u.url)).toEqual(["https://de.wikipedia.org/wiki/Foo_(Bar)"]);
    expect(findUrls("(siehe https://x.org/Foo_(Bar)).").map((u) => u.url)).toEqual(["https://x.org/Foo_(Bar)"]);
  });
  it("follows Bluesky's hashtag rules", () => {
    const tags = findHashtags("#Wien… #KI» #Tag“ #2024Wahl #2024 ＃Voll");
    expect(tags.map((t) => t.tag)).toEqual(["Wien", "KI", "Tag", "2024Wahl", "Voll"]);
    expect(tags[0]).toEqual({ start: 0, end: 5, tag: "Wien" });
    expect(findHashtags("#" + "ä".repeat(64) + " #" + "a".repeat(65)).map((t) => t.tag.length)).toEqual([64]);
  });
  it("returns no facets for plain text", () => {
    expect(buildFacets("plain")).toEqual([]);
  });
});

describe("escapeLittle", () => {
  it("escapes markup characters but keeps hashtags", () => {
    expect(escapeLittle("Hi (you) [x] {y} 100% a_b *c* ~d~ <e> | @f \\ #Django #2026 g#h #")).toBe(
      "Hi \\(you\\) \\[x\\] \\{y\\} 100% a\\_b \\*c\\* \\~d\\~ \\<e\\> \\| \\@f \\\\ #Django #2026 g\\#h \\#",
    );
    expect(escapeLittle("#Start of text")).toBe("#Start of text");
  });
});

describe("rules", () => {
  it("applies defaults and file rules case-insensitively", () => {
    expect(checkRules("a — b", [])).toEqual(["—"]);
    expect(checkRules("Dive Into it", parseRules("# c\ndive into\n"))).toEqual(["dive into"]);
    expect(checkRules("https://x.example/?utm_source=a", [])).toEqual(["utm_"]);
    expect(checkRules("clean", ["nope"])).toEqual([]);
  });
});
