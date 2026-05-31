import { describe, it, expect } from "vitest";
import { headerSignature } from "@/lib/csv/profile";

describe("headerSignature", () => {
  it("is stable across case and surrounding whitespace", () => {
    const a = headerSignature(["Data operacji", "Opis operacji", "Kwota"]);
    const b = headerSignature([" data operacji ", "OPIS OPERACJI", "kwota"]);
    expect(a).toBe(b);
  });
  it("differs for different headers (including order)", () => {
    const a = headerSignature(["a", "b", "c"]);
    expect(a).not.toBe(headerSignature(["a", "b"]));
    expect(a).not.toBe(headerSignature(["c", "b", "a"]));
  });
  it("returns a 64-char hex sha256 digest", () => {
    expect(headerSignature(["a", "b"])).toMatch(/^[0-9a-f]{64}$/);
  });
});
