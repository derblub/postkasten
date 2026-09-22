import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses scalars, one nesting level, quotes and comments", () => {
    const { data, body } = parseFrontmatter(
      ['---', 'at: 2026-09-29T08:30:00+02:00', '# comment', 'linkedin:', '  link: https://a.example/x', '  title: "Quoted: value"', 'bluesky:', "  link: 'https://b.example/y'  # trailing", '---', '## linkedin', 'Text'].join("\n"),
    );
    expect(data).toEqual({
      at: "2026-09-29T08:30:00+02:00",
      linkedin: { link: "https://a.example/x", title: "Quoted: value" },
      bluesky: { link: "https://b.example/y" },
    });
    expect(body).toBe("## linkedin\nText");
  });

  it("rejects files without a fence and unclosed fences", () => {
    expect(() => parseFrontmatter("at: x")).toThrow(/must start/);
    expect(() => parseFrontmatter("---\nat: x\n")).toThrow(/never closed/);
  });

  it("rejects odd indentation and orphans", () => {
    expect(() => parseFrontmatter("---\n  link: x\n---\n")).toThrow(/without a parent/);
    expect(() => parseFrontmatter("---\nlinkedin:\n   link: x\n---\n")).toThrow(/two spaces/);
  });
});
