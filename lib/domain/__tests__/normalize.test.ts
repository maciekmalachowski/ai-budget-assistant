import { describe, it, expect } from "vitest";
import { computeDedupHash } from "@/lib/domain/normalize";

describe("computeDedupHash", () => {
  const base = {
    accountId: "acc-1",
    bookedAt: "2026-05-12",
    amountMinor: -8740,
    rawDescription: "BIEDRONKA 1234 WARSZAWA",
    occurrence: 0,
  };

  it("is stable for identical input", () => {
    expect(computeDedupHash(base)).toBe(computeDedupHash({ ...base }));
  });
  it("ignores case/whitespace differences in the description", () => {
    expect(computeDedupHash(base)).toBe(
      computeDedupHash({ ...base, rawDescription: "  biedronka 1234   warszawa " }),
    );
  });
  it("differs when the occurrence index differs", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, occurrence: 1 }));
  });
  it("differs when the amount differs", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, amountMinor: -8741 }));
  });
  it("returns a 64-char hex sha256 digest", () => {
    expect(computeDedupHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
