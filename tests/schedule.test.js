import { describe, expect, it } from "vitest";
import { formatLocal, offsetAt, parseAt } from "../src/schedule.js";

describe("parseAt", () => {
  it("requires an explicit offset", () => {
    expect(parseAt("2026-09-29T08:30:00+02:00")).toEqual({ ms: Date.parse("2026-09-29T06:30:00Z"), offset: "+02:00" });
    expect(parseAt("2026-09-29T08:30Z").offset).toBe("+00:00");
    expect(() => parseAt("2026-09-29T08:30:00")).toThrow(/explicit offset/);
    expect(() => parseAt("2026-09-29")).toThrow(/explicit offset/);
  });
});

describe("offsetAt", () => {
  it("knows Vienna summer and winter time", () => {
    expect(offsetAt(Date.parse("2026-09-29T06:30:00Z"), "Europe/Vienna")).toBe("+02:00");
    expect(offsetAt(Date.parse("2026-11-10T07:30:00Z"), "Europe/Vienna")).toBe("+01:00");
    expect(offsetAt(Date.parse("2026-11-10T07:30:00Z"), "UTC")).toBe("+00:00");
    expect(offsetAt(Date.parse("2026-11-10T07:30:00Z"), "Asia/Kolkata")).toBe("+05:30");
  });
});

describe("formatLocal", () => {
  it("prints weekday, date and time in the zone", () => {
    expect(formatLocal(Date.parse("2026-09-29T06:30:00Z"), "Europe/Vienna")).toBe("Tue 2026-09-29 08:30");
  });
});
