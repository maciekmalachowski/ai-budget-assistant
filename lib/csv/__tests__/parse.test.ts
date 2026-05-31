// @vitest-environment node
// (needs node:fs to read fixture files; the global vitest env is jsdom)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import iconv from "iconv-lite";
import {
  detectEncoding,
  decodeBuffer,
  detectDelimiter,
  parseCsv,
  parseCsvBuffer,
} from "@/lib/csv/parse";

const sampleBuf = readFileSync(new URL("./fixtures/mbank-sample.csv", import.meta.url));

describe("detectEncoding", () => {
  it("detects UTF-8 for the sample fixture", () => {
    expect(detectEncoding(sampleBuf)).toBe("utf-8");
  });
  it("falls back to win1250 for bytes that are invalid UTF-8", () => {
    const buf = iconv.encode("PŁATNOŚĆ ŻABKA", "win1250");
    expect(detectEncoding(buf)).toBe("win1250");
  });
});

describe("decodeBuffer", () => {
  it("round-trips Windows-1250 Polish characters", () => {
    const buf = iconv.encode("PŁATNOŚĆ ŻABKA", "win1250");
    expect(decodeBuffer(buf, "win1250")).toBe("PŁATNOŚĆ ŻABKA");
  });
});

describe("detectDelimiter", () => {
  it("picks ';' for the sample header", () => {
    expect(detectDelimiter(decodeBuffer(sampleBuf))).toBe(";");
  });
  it("picks ',' for a comma header", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });
});

describe("parseCsvBuffer", () => {
  it("parses the sample into header + rows", () => {
    const { header, rows, encoding, delimiter } = parseCsvBuffer(sampleBuf);
    expect(encoding).toBe("utf-8");
    expect(delimiter).toBe(";");
    expect(header).toEqual(["Data operacji", "Opis operacji", "Kwota", "Saldo po operacji"]);
    expect(rows).toHaveLength(4);
    expect(rows[0]["Opis operacji"]).toBe("BIEDRONKA 1234 WARSZAWA");
    expect(rows[0]["Kwota"]).toBe("-87,40");
  });
});

describe("parseCsv", () => {
  it("trims header names", () => {
    const { header } = parseCsv(" a ;b\n1;2", ";");
    expect(header).toEqual(["a", "b"]);
  });
});
