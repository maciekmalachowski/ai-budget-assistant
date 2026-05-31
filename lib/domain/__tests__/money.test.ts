import { describe, it, expect } from "vitest";
import { parseAmount, combineDebitCredit } from "@/lib/domain/money";

describe("parseAmount", () => {
  it("parses negative comma-decimal amounts to signed minor units", () => {
    expect(parseAmount("-87,40", { decimalSep: "," })).toBe(-8740);
  });
  it("strips space and nbsp thousands separators", () => {
    expect(parseAmount("9 500,00", { decimalSep: "," })).toBe(950000);
    expect(parseAmount("1 234,56", { decimalSep: "," })).toBe(123456);
  });
  it("treats dot as thousands when comma is the decimal separator", () => {
    expect(parseAmount("1.234,56", { decimalSep: "," })).toBe(123456);
  });
  it("handles US style (dot decimal, comma thousands)", () => {
    expect(parseAmount("1,234.56", { decimalSep: "." })).toBe(123456);
  });
  it("parses explicit plus sign and parentheses-negatives", () => {
    expect(parseAmount("+43,00", { decimalSep: "," })).toBe(4300);
    expect(parseAmount("(12,00)", { decimalSep: "," })).toBe(-1200);
  });
  it("throws on unparseable input", () => {
    expect(() => parseAmount("abc", { decimalSep: "," })).toThrow();
    expect(() => parseAmount("", { decimalSep: "," })).toThrow();
  });
  it("parses a plain integer with no decimal part", () => {
    expect(parseAmount("100", { decimalSep: "," })).toBe(10000);
  });
});

describe("combineDebitCredit", () => {
  it("makes debit negative and credit positive", () => {
    expect(combineDebitCredit("87,40", "", { decimalSep: "," })).toBe(-8740);
    expect(combineDebitCredit("", "9 500,00", { decimalSep: "," })).toBe(950000);
  });
  it("ignores a zero-filled unused side", () => {
    expect(combineDebitCredit("0,00", "9 500,00", { decimalSep: "," })).toBe(950000);
  });
  it("throws when both sides are empty or both non-zero", () => {
    expect(() => combineDebitCredit("", "", { decimalSep: "," })).toThrow();
    expect(() => combineDebitCredit("10,00", "5,00", { decimalSep: "," })).toThrow();
  });
  it("treats an explicit zero with the other side blank as a zero amount", () => {
    expect(combineDebitCredit("0,00", "", { decimalSep: "," })).toBe(0);
  });
});
