import { describe, it, expect } from "vitest";
import { extractMerchant, brandNormalize } from "@/lib/domain/merchant";

const CARD_ELECLERC =
  "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk";
const CARD_ALDI =
  "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK";

describe("extractMerchant — card payments", () => {
  it("extracts the brand from a card payment, dropping store# and city", () => {
    expect(extractMerchant(CARD_ELECLERC)).toBe("ELECLERC");
  });

  it("strips legal-entity suffixes and store#/city from a card payment", () => {
    expect(extractMerchant(CARD_ALDI)).toBe("ALDI");
  });

  it("is idempotent on an already-clean brand", () => {
    expect(extractMerchant(extractMerchant(CARD_ELECLERC))).toBe("ELECLERC");
    expect(extractMerchant("ALDI")).toBe("ALDI");
    expect(extractMerchant("BIEDRONKA WARSZAWA")).toBe("BIEDRONKA WARSZAWA");
  });
});

describe("extractMerchant — generic fallback (non-card lines)", () => {
  it("strips long digit runs and amount+currency, keeps the counterparty", () => {
    expect(extractMerchant("PRZELEW WYCHODZĄCY 12345678 JAN KOWALSKI 100,00 PLN")).toBe(
      "PRZELEW WYCHODZĄCY JAN KOWALSKI",
    );
  });

  it("strips masked card tokens", () => {
    expect(extractMerchant("421352******0246 ZABKA WARSZAWA")).toBe("ZABKA WARSZAWA");
  });

  it("never returns an empty string, even for a merchant-less line", () => {
    expect(extractMerchant("DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN").length).toBeGreaterThan(0);
  });
});

describe("brandNormalize", () => {
  it("uppercases and collapses whitespace", () => {
    expect(brandNormalize("  eLeclerc   gdansk ")).toBe("ELECLERC GDANSK");
  });

  it("strips a trailing store# + city", () => {
    expect(brandNormalize("ELECLERC 01 GDANSK")).toBe("ELECLERC");
  });

  it("strips a legal-entity suffix", () => {
    expect(brandNormalize("ALDI SP. Z O.O.")).toBe("ALDI");
  });

  it("falls back to the input when stripping would empty the string", () => {
    expect(brandNormalize("01 GDANSK")).toBe("01 GDANSK");
  });
});
