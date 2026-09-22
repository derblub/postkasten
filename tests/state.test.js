import { describe, expect, it } from "vitest";
import { openIntents, orphanedEntries, parseState, resolveStatus } from "../src/state.js";

const F = "posts/a.md";
const AT = "2026-09-29T08:30:00+02:00";
const line = (status, extra = {}, ts = "2026-09-29T06:31:00Z") => ({ file: F, channel: "linkedin", status, at: AT, ts, ...extra });

describe("resolveStatus", () => {
  it("is pending without history", () => {
    expect(resolveStatus([], F, "linkedin", AT)).toEqual({ status: "pending", failures: 0 });
  });
  it("published wins regardless of at", () => {
    expect(resolveStatus([line("published")], F, "linkedin", "2030-01-01T00:00:00Z").status).toBe("published");
  });
  it("an intent without a result blocks", () => {
    expect(resolveStatus([line("intent")], F, "linkedin", AT).status).toBe("blocked");
  });
  it("an intent followed by failed is no longer open", () => {
    const s = resolveStatus([line("intent"), line("failed", {}, "2026-09-29T06:32:00Z")], F, "linkedin", AT);
    expect(s).toEqual({ status: "pending", failures: 1 });
  });
  it("gives up after three failures for the same at, re-arms when re-dated", () => {
    const entries = [1, 2, 3].map((i) => line("failed", {}, `2026-09-29T06:3${i}:00Z`));
    expect(resolveStatus(entries, F, "linkedin", AT).status).toBe("given_up");
    expect(resolveStatus(entries, F, "linkedin", "2026-10-06T08:30:00+02:00").status).toBe("pending");
  });
  it("skipped is bound to at", () => {
    expect(resolveStatus([line("skipped")], F, "linkedin", AT).status).toBe("skipped");
    expect(resolveStatus([line("skipped")], F, "linkedin", "2026-10-06T08:30:00+02:00").status).toBe("pending");
  });
  it("channels are independent", () => {
    expect(resolveStatus([line("published")], F, "bluesky", AT).status).toBe("pending");
  });
});

describe("helpers", () => {
  it("parses jsonl and reports bad lines", () => {
    expect(parseState('{"a":1}\n\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(() => parseState("{nope")).toThrow(/line 1/);
  });
  it("finds orphans and open intents", () => {
    expect(orphanedEntries([line("published")], [])).toHaveLength(1);
    expect(openIntents([line("intent"), line("intent", { channel: "bluesky" }), line("published", {}, "2026-09-29T06:32:00Z")])).toEqual([
      line("intent", { channel: "bluesky" }),
    ]);
  });
});
