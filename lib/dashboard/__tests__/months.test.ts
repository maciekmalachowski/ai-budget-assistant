import { describe, it, expect } from "vitest";
import { dashboardMonthOptions, safeMonth } from "@/lib/dashboard/months";

describe("dashboardMonthOptions", () => {
  it("includes the current month even when it has no data yet", () => {
    expect(dashboardMonthOptions(["2026-04", "2026-03"], "2026-06", "2026-06")).toEqual([
      "2026-06",
      "2026-04",
      "2026-03",
    ]);
  });

  it("includes a deep-linked selected month that isn't in the data", () => {
    expect(dashboardMonthOptions(["2026-06"], "2026-06", "2025-12")).toContain("2025-12");
  });

  it("dedupes and sorts newest-first", () => {
    expect(dashboardMonthOptions(["2026-03", "2026-06", "2026-03"], "2026-06", "2026-03")).toEqual([
      "2026-06",
      "2026-03",
    ]);
  });

  it("returns just the current month when there is no data", () => {
    expect(dashboardMonthOptions([], "2026-06", "2026-06")).toEqual(["2026-06"]);
  });
});

describe("safeMonth", () => {
  const fallback = "2026-06";

  it("passes a valid YYYY-MM month through unchanged", () => {
    expect(safeMonth("2026-04", fallback)).toBe("2026-04");
  });

  it("falls back when the param is missing", () => {
    expect(safeMonth(undefined, fallback)).toBe(fallback);
  });

  it("falls back on a malformed (non YYYY-MM) param", () => {
    expect(safeMonth("2026-4", fallback)).toBe(fallback);
    expect(safeMonth("nope", fallback)).toBe(fallback);
    expect(safeMonth("2026-04-01", fallback)).toBe(fallback);
  });

  it("falls back on an out-of-range month that parsePeriod rejects", () => {
    expect(safeMonth("2026-13", fallback)).toBe(fallback);
    expect(safeMonth("2026-00", fallback)).toBe(fallback);
  });
});
