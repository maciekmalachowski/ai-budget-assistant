import { describe, it, expect } from "vitest";
import { guessMapping, guessDateColumn, detectStartRow } from "@/lib/csv/detect";

// File 1 shape: 9 columns, no preamble, booking + value dates in DD-MM-YYYY.
const noPreamble: string[][] = [
  ["31-05-2026", "31-05-2026", "UZNANIE Odsetki od salda dodatniego", "", "", "37,40", "33981,46", "1", ""],
  ["31-05-2026", "31-05-2026", "OBCIAZENIE Podatek pobrany", "", "", "-7,11", "33974,35", "2", ""],
  ["04-05-2026", "04-05-2026", "Between your own accounts", "MACIEJ M", "08 1090 2590", "-10000,00", "33944,06", "3", ""],
  ["02-05-2026", "02-05-2026", "BIEDRONKA 123 BIALYSTOK", "", "", "-45,20", "33989,26", "4", ""],
  ["01-05-2026", "01-05-2026", "Przelew przychodzacy", "JAN KOWALSKI", "12 3456", "2500,00", "34034,46", "5", ""],
];

// File 2 shape: 9 columns, row 0 is an account-info line (booking date YYYY-MM-DD), then 5 transactions.
const withPreamble: string[][] = [
  ["2026-06-02", "01-06-2026", "'08 1090 2590 0000 0001 4198 1663", "MACIEJ M", "PLN", "5667,08", "5767,08", "1", ""],
  ["01-06-2026", "01-06-2026", "dzien dziecka - na lody", "URSZULA M", "96 1910", "100,00", "5767,08", "1", ""],
  ["31-05-2026", "31-05-2026", "BLIK zakup", "SKLEP", "", "-23,50", "5667,08", "2", ""],
  ["30-05-2026", "30-05-2026", "Wyplata BLIK", "", "", "-200,00", "5691,08", "3", ""],
  ["29-05-2026", "29-05-2026", "Wynagrodzenie", "FIRMA", "11 2222", "4500,00", "5891,08", "4", ""],
  ["28-05-2026", "28-05-2026", "ZABKA Z123", "", "", "-15,99", "6091,08", "5", ""],
];

describe("guessDateColumn", () => {
  it("prefers the leftmost column meeting the threshold", () => {
    // Both col 0 and col 1 are DD-MM-YYYY here; the leftmost (col 0) must win.
    expect(guessDateColumn(noPreamble, 9)).toEqual({ index: 0, format: "DD-MM-YYYY" });
  });
  it("keys off the booking-date column even when it has a preamble in another format", () => {
    expect(guessDateColumn(withPreamble, 9)).toEqual({ index: 0, format: "DD-MM-YYYY" });
  });
});

describe("guessMapping", () => {
  it("guesses date, amount, and decimal separator for the bank layout", () => {
    const m = guessMapping(noPreamble, 9, "PLN");
    expect(m.dateColumn).toBe("Column 1");
    expect(m.dateFormat).toBe("DD-MM-YYYY");
    expect(m.amount).toEqual({ mode: "signed", amountColumn: "Column 6" });
    expect(m.decimalSep).toBe(",");
    // The always-populated transaction text (col 3) must win over the sparse
    // counterparty column (col 4), which holds one long value on only some rows.
    expect(m.descriptionColumns).toEqual(["Column 3"]);
  });
});

describe("detectStartRow", () => {
  it("returns 0 when the first row is already a transaction", () => {
    const m = guessMapping(noPreamble, 9, "PLN");
    expect(detectStartRow(noPreamble, m)).toBe(0);
  });
  it("skips a leading account-info line", () => {
    const m = guessMapping(withPreamble, 9, "PLN");
    expect(detectStartRow(withPreamble, m)).toBe(1);
  });
});
