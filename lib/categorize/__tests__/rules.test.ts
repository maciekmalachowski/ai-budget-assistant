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
  it("treats 'contains' patterns literally, not as regex", () => {
    const r: MerchantRule[] = [{ matchType: "contains", pattern: "SHOP.COM", categoryId: "x" }];
    expect(categorizeByRules("MY SHOP.COM STORE", "MY SHOP.COM", r)).toBe("x");
    expect(categorizeByRules("SHOPXCOM", "SHOPXCOM", r)).toBeNull();
  });
});

describe("categorizeByRules with opts.containsText", () => {
  // Brand-only rules (no exact), to isolate the contains/regex scoping behavior.
  const brandRules: MerchantRule[] = [
    { matchType: "contains", pattern: "AGATA", categoryId: "shopping" },
    { matchType: "regex", pattern: "APTEKA", categoryId: "health" },
  ];

  it("scopes 'contains' to containsText, not merchant/rawDescription", () => {
    // The payee name "AGATA NOWAK" lives in merchant + rawDescription, but the note (containsText)
    // is "KWIATKI DLA MAMY" — the AGATA brand rule must NOT fire.
    expect(
      categorizeByRules("KWIATKI DLA MAMY AGATA NOWAK", "AGATA NOWAK", brandRules, { containsText: "KWIATKI DLA MAMY" }),
    ).toBeNull();
    // When the brand IS in containsText, the contains rule fires.
    expect(
      categorizeByRules("AGATA MEBLE GDANSK", "AGATA", brandRules, { containsText: "AGATA MEBLE GDANSK" }),
    ).toBe("shopping");
  });

  it("scopes 'regex' to containsText too", () => {
    // "APTEKARSKA" appears in the payee/raw line but not in the note → regex must not match.
    expect(
      categorizeByRules("PRZELEW APTEKARSKA NOWAK", "APTEKARSKA NOWAK", brandRules, { containsText: "PRZELEW" }),
    ).toBeNull();
    expect(
      categorizeByRules("ZAKUP APTEKA SLONECZNA", "APTEKA SLONECZNA", brandRules, { containsText: "ZAKUP APTEKA SLONECZNA" }),
    ).toBe("health");
  });

  it("leaves 'exact' matching merchant/rawDescription regardless of opts", () => {
    // A user/AI exact correction on the payee name must still stick even though the note differs.
    const exactRules: MerchantRule[] = [
      { matchType: "contains", pattern: "AGATA", categoryId: "shopping" },
      { matchType: "exact", pattern: "AGATA NOWAK", categoryId: "user-fixed" },
    ];
    expect(
      categorizeByRules("KWIATKI DLA MAMY", "AGATA NOWAK", exactRules, { containsText: "KWIATKI DLA MAMY" }),
    ).toBe("user-fixed");
  });

  it("empty containsText disables contains/regex but keeps exact", () => {
    const mixed: MerchantRule[] = [
      { matchType: "contains", pattern: "AGATA", categoryId: "shopping" },
      { matchType: "exact", pattern: "AGATA NOWAK", categoryId: "user-fixed" },
    ];
    expect(categorizeByRules("AGATA NOWAK", "AGATA NOWAK", mixed, { containsText: "" })).toBe("user-fixed");
    const onlyBrand: MerchantRule[] = [{ matchType: "contains", pattern: "DINO", categoryId: "groceries" }];
    expect(categorizeByRules("PRZELEW DINO KOWALSKI", "DINO KOWALSKI", onlyBrand, { containsText: "" })).toBeNull();
  });
});
