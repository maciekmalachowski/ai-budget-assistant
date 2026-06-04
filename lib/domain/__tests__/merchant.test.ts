import { describe, it, expect } from "vitest";
import { extractMerchant, brandNormalize } from "@/lib/domain/merchant";

const CARD_ELECLERC = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk";
const CARD_ALDI = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK";
const CARD_BIEDRONKA = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 19.16 PLN JMP S.A. BIEDRONKA 3808 BIALYSTOK";
const CARD_ZABKA = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 5.99 PLN ZABKA Z9241 K.1 GDANSK";

describe("extractMerchant — card", () => {
  it("extracts the brand, dropping store# and city", () => {
    expect(extractMerchant("card", CARD_ELECLERC, "")).toBe("ELECLERC");
    expect(extractMerchant("card", CARD_ALDI, "")).toBe("ALDI");
  });

  it("extracts a brand buried after an operator prefix", () => {
    expect(extractMerchant("card", CARD_BIEDRONKA, "")).toContain("BIEDRONKA");
    expect(extractMerchant("card", CARD_ZABKA, "")).toContain("ZABKA");
  });

  it("never returns empty for a merchant-less card line", () => {
    expect(extractMerchant("card", "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN", "").length).toBeGreaterThan(0);
  });
});

describe("extractMerchant — blik", () => {
  it("prefers the counterparty, stripped to a brand", () => {
    expect(extractMerchant("blik", "Zakup BLIK Decathlon Sp. z o.o. Geodezyjna 76 ref:94077292755", "Decathlon Sp. z o.o. Geodezyjna 76")).toBe("DECATHLON");
  });

  it("falls back to the title between BLIK and ref: when counterparty is empty", () => {
    expect(extractMerchant("blik", "Zwrot BLIK PayPro S.A. Pastelowa 8 ref:93601725170", "")).toContain("PAYPRO");
  });
});

describe("extractMerchant — transfer / internal", () => {
  it("uses the counterparty name, Title-Cased, address stripped", () => {
    expect(extractMerchant("transfer", "Przelew na telefon Od: 48604263864 Do: 485*****130", "JULIA ZAKRZEWSKA")).toBe("Julia Zakrzewska");
    expect(extractMerchant("transfer", "kwiatki dla mamy", "Szymek")).toBe("Szymek");
  });

  it("strips a street address and postcode from a person", () => {
    expect(extractMerchant("transfer", "ZA KABABY", "MACIEJ IWANIUK UL.GORODZISKO 36 17-210 GORODZISKO")).toBe("Maciej Iwaniuk");
  });

  it("preserves Polish diacritics while Title-Casing a person, stripping UL.+postcode+city (spec case)", () => {
    expect(
      extractMerchant("transfer", "Przelew", "MACIEJ MAŁACHOWSKI UL. KROKUSOWA 9 15-584 BIAŁYSTOK"),
    ).toBe("Maciej Małachowski");
  });

  it("strips a spelled-out legal form and address from a company", () => {
    expect(
      extractMerchant("transfer", "Umowa zlecenie kwiecień 2026", "AUTOMEE SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ ALEJA GRUNWALDZKA 472B 80-236 GDAŃSK ELIXIR 08-05-2026"),
    ).toBe("Automee");
  });

  it("falls back to the cleaned title when no counterparty", () => {
    expect(extractMerchant("transfer", "Przelew środków", "").length).toBeGreaterThan(0);
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
    expect(brandNormalize("S.A.")).toBe("S.A.");
  });
});
