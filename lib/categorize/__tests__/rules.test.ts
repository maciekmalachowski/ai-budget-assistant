import { describe, it, expect } from "vitest";
import { categorizeByRules } from "@/lib/categorize/rules";
import type { MerchantRule } from "@/lib/domain/types";

const rules: MerchantRule[] = [
  { matchType: "contains", pattern: "BIEDRONKA", categoryId: "groceries" },
  { matchType: "regex", pattern: "^UBER", categoryId: "transport" },
  { matchType: "exact", pattern: "NETFLIX.COM", categoryId: "subs" },
];

describe("categorizeByRules", () => {
  it("matches a 'contains' rule against the description", () => {
    expect(categorizeByRules("BIEDRONKA 1234 WARSZAWA", "BIEDRONKA WARSZAWA", rules)).toBe("groceries");
  });
  it("matches a 'regex' rule (case-insensitive)", () => {
    expect(categorizeByRules("uber *trip help.uber.com", "UBER *TRIP", rules)).toBe("transport");
  });
  it("matches an 'exact' rule against the full description or merchant", () => {
    expect(categorizeByRules("NETFLIX.COM", "NETFLIX.COM", rules)).toBe("subs");
  });
  it("returns null when nothing matches", () => {
    expect(categorizeByRules("SALARY ACME SP Z OO", "SALARY ACME SP Z OO", rules)).toBeNull();
  });
  it("returns the first matching rule's category (order wins)", () => {
    const ordered: MerchantRule[] = [
      { matchType: "contains", pattern: "SHOP", categoryId: "first" },
      { matchType: "contains", pattern: "SHOP", categoryId: "second" },
    ];
    expect(categorizeByRules("BIG SHOP", "BIG SHOP", ordered)).toBe("first");
  });
  it("throws on an invalid regex pattern", () => {
    const bad: MerchantRule[] = [{ matchType: "regex", pattern: "[", categoryId: "x" }];
    expect(() => categorizeByRules("anything", "ANYTHING", bad)).toThrow();
  });
});
