import { describe, it, expect } from "vitest";
import { parseDate } from "@/lib/domain/dates";

describe("parseDate", () => {
  it("parses each supported format to ISO YYYY-MM-DD", () => {
    expect(parseDate("12.05.2026", "DD.MM.YYYY")).toBe("2026-05-12");
    expect(parseDate("12-05-2026", "DD-MM-YYYY")).toBe("2026-05-12");
    expect(parseDate("2026-05-12", "YYYY-MM-DD")).toBe("2026-05-12");
    expect(parseDate("12/05/2026", "DD/MM/YYYY")).toBe("2026-05-12");
    expect(parseDate("05/12/2026", "MM/DD/YYYY")).toBe("2026-05-12");
  });
  it("trims surrounding whitespace", () => {
    expect(parseDate("  12.05.2026 ", "DD.MM.YYYY")).toBe("2026-05-12");
  });
  it("throws when the value does not match the format", () => {
    expect(() => parseDate("2026-05-12", "DD.MM.YYYY")).toThrow();
  });
  it("throws on impossible dates", () => {
    expect(() => parseDate("32.13.2026", "DD.MM.YYYY")).toThrow();
    expect(() => parseDate("29.02.2027", "DD.MM.YYYY")).toThrow(); // 2027 not leap
  });
  it("accepts a valid leap day", () => {
    expect(parseDate("29.02.2028", "DD.MM.YYYY")).toBe("2028-02-29");
  });
});
