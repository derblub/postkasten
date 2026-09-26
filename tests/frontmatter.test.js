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

  it("ignores a leading byte order mark", () => {
    expect(parseFrontmatter("﻿---\na: b\n---\nbody").data).toEqual({ a: "b" });
  });

  it("decodes escapes in quoted values and keeps unquoted ' #' as a comment", () => {
    const { data } = parseFrontmatter(
      ["---", 't1: "Sag \\"Hallo\\" bitte"', "t2: 'It''s'", 't3: "a\\\\b"  # note', "t4: Folge #3", 't5: "Folge #3"', 't6: "C:\\Users a\\nb"', "---"].join("\n"),
    );
    expect(data).toEqual({ t1: 'Sag "Hallo" bitte', t2: "It's", t3: "a\\b", t4: "Folge", t5: "Folge #3", t6: "C:\\Users a\\nb" });
  });

  it("rejects unterminated quotes and text after the closing quote", () => {
    expect(() => parseFrontmatter('---\ntitle: "A" und B\n---\n')).toThrow(/line 2: unexpected text after quoted value/);
    expect(() => parseFrontmatter('---\nx:\n  title: "open\n---\n')).toThrow(/line 3: unterminated quoted value/);
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
