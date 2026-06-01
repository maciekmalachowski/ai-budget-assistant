import { describe, it, expect } from "vitest";
import { formatMoneyMinor, lastNMonths, shortMonthLabel } from "@/lib/format";

describe("formatMoneyMinor", () => {
  it("formats signed minor units as currency (deterministic en-US/USD)", () => {
    expect(formatMoneyMinor(-482000, "USD", "en-US")).toBe("-$4,820.00");
    expect(formatMoneyMinor(0, "USD", "en-US")).toBe("$0.00");
    expect(formatMoneyMinor(12345, "USD", "en-US")).toBe("$123.45");
  });

  it("includes the PLN currency for the default locale", () => {
    expect(formatMoneyMinor(-482000, "PLN")).toContain("zł");
  });
});

describe("lastNMonths", () => {
  it("returns N consecutive months ending at the given month, oldest first", () => {
    expect(lastNMonths("2026-06", 6)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  });
  it("crosses the year boundary", () => {
    expect(lastNMonths("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("throws on a non-month", () => {
    expect(() => lastNMonths("2026-13", 3)).toThrow();
  });
});

describe("shortMonthLabel", () => {
  it("maps a month to its short name", () => {
    expect(shortMonthLabel("2026-05")).toBe("May");
    expect(shortMonthLabel("2026-12")).toBe("Dec");
  });
});
