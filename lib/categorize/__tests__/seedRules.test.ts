import { describe, it, expect } from "vitest";
import { SEED_RULES } from "@/lib/categorize/seedRules";
import { categorizeByRules } from "@/lib/categorize/rules";
import type { MerchantRule } from "@/lib/domain/types";

// Build in-memory rules with the category NAME used as a stand-in id, sorted exact→contains.
const PRIORITY = { exact: 0, contains: 1, regex: 2 } as const;
const rules: MerchantRule[] = SEED_RULES.map((r) => ({
  matchType: r.matchType,
  pattern: r.pattern,
  categoryId: r.categoryName,
})).sort((a, b) => PRIORITY[a.matchType] - PRIORITY[b.matchType]);

const cat = (raw: string, merchant = "") => categorizeByRules(raw, merchant, rules);

describe("seed rules categorize real Santander lines", () => {
  it("groceries", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK")).toBe("Groceries");
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 19.16 PLN JMP S.A. BIEDRONKA 3808 BIALYSTOK")).toBe("Groceries");
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 5.99 PLN ZABKA Z9241 K.1 GDANSK")).toBe("Groceries");
  });
  it("transport", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 25.00 PLN jakdojade.pl Poznan")).toBe("Transport");
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 11.49 PLN ORLEN STACJA NR 1419 BIALYSTOK")).toBe("Transport");
  });
  it("dining keeps UBER EATS out of transport", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 74.98 PLN UBER * EATS PENDING AMSTERDAM")).toBe("Dining");
  });
  it("housing from the transfer note", () => {
    expect(cat("Czynsz i opłaty kwiecień Radek Właściciel")).toBe("Housing");
  });
  it("income from a salary note", () => {
    expect(cat("Umowa zlecenie kwiecień 2026 Automee")).toBe("Income");
  });
  it("returns null for an unknown merchant", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 87.00 PLN MB&SJ COMPANY Gdansk")).toBeNull();
  });
});
