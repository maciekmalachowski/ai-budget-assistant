import { describe, it, expect } from "vitest";
import { parsePeriod, previousMonth, daysInMonth, daysElapsed } from "@/lib/queries/period";

describe("parsePeriod", () => {
  it("parses a whole month with correct last day and label", () => {
    expect(parsePeriod("2026-05")).toEqual({
      fromISO: "2026-05-01",
      toISO: "2026-05-31",
      label: "May 2026",
    });
  });

  it("handles February in leap and non-leap years", () => {
    expect(parsePeriod("2024-02").toISO).toBe("2024-02-29");
    expect(parsePeriod("2026-02").toISO).toBe("2026-02-28");
  });

  it("parses an inclusive day range", () => {
    expect(parsePeriod("2026-05-03..2026-05-10")).toEqual({
      fromISO: "2026-05-03",
      toISO: "2026-05-10",
      label: "2026-05-03 to 2026-05-10",
    });
  });

  it("throws on malformed input or a backwards range or bad month", () => {
    expect(() => parsePeriod("garbage")).toThrow();
    expect(() => parsePeriod("2026-13")).toThrow();
    expect(() => parsePeriod("2026-05-10..2026-05-03")).toThrow();
  });
});

describe("previousMonth", () => {
  it("steps back within a year and across the year boundary", () => {
    expect(previousMonth("2026-05")).toBe("2026-04");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });

  it("throws when given something that is not a month or an out-of-range month", () => {
    expect(() => previousMonth("2026-05-01")).toThrow();
    expect(() => previousMonth("2026-13")).toThrow();
    expect(() => previousMonth("2026-00")).toThrow();
  });
});

describe("daysInMonth", () => {
  it("returns the day count including leap February", () => {
    expect(daysInMonth("2026-05")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29);
  });
  it("throws on a bad month", () => {
    expect(() => daysInMonth("2026-13")).toThrow();
  });
});

describe("daysElapsed", () => {
  it("is the full month for a wholly-past month", () => {
    expect(daysElapsed("2026-04", "2026-05-10")).toBe(30);
  });
  it("is zero for a wholly-future month", () => {
    expect(daysElapsed("2026-06", "2026-05-10")).toBe(0);
  });
  it("is today's day-of-month for the in-progress month, clamped to the month length", () => {
    expect(daysElapsed("2026-05", "2026-05-10")).toBe(10);
    expect(daysElapsed("2026-02", "2026-02-31")).toBe(28);
  });
});
