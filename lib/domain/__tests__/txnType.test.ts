import { describe, it, expect } from "vitest";
import { classifyTransaction } from "@/lib/domain/txnType";

describe("classifyTransaction", () => {
  it("classifies card payments", () => {
    expect(
      classifyTransaction("DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK", ""),
    ).toBe("card");
  });

  it("classifies card refunds as card", () => {
    expect(
      classifyTransaction("DOP. VISA 421352******0246 ZWROT PŁATNOŚCI KARTĄ 73.62 PLN Temu.com INTERNET", ""),
    ).toBe("card");
  });

  it("classifies BLIK purchases, refunds and phone transfers", () => {
    expect(classifyTransaction("Zakup BLIK Decathlon Sp. z o.o. ref:94077292755", "Decathlon Sp. z o.o.")).toBe("blik");
    expect(classifyTransaction("Zwrot BLIK PayPro S.A. ref:93601725170", "")).toBe("blik");
    expect(classifyTransaction("Przelew BLIK na telefon", "MALINOWSKI DAMIAN")).toBe("blik");
  });

  it("classifies internal own-account moves", () => {
    expect(classifyTransaction("Between your own accounts", "MACIEJ MAŁACHOWSKI UL. KROKUSOWA 9")).toBe("internal");
  });

  it("classifies bank fees / interest", () => {
    expect(classifyTransaction("UZNANIE Odsetki od salda dodatniego", "")).toBe("fee");
    expect(classifyTransaction("OBCIĄŻENIE Podatek pobrany", "")).toBe("fee");
  });

  it("classifies everything else with a counterparty as a transfer", () => {
    expect(classifyTransaction("Przelew na telefon Od: 48604263864 Do: 485*****130", "JULIA ZAKRZEWSKA")).toBe("transfer");
    expect(classifyTransaction("kwiatki dla mamy", "Szymek")).toBe("transfer");
    expect(classifyTransaction("Przelew", "TERESA KASPEROWICZ SOKOLE 43")).toBe("transfer");
  });
});
