import { describe, it, expect } from "vitest";
import { computeDedupHash, canonicalizeForHash, titleDedupBaseKey, titleDedupHash } from "@/lib/domain/normalize";

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

describe("title dedup helpers", () => {
  const fields = { bookedAt: "2026-05-12", amountMinor: -8740, title: "BIEDRONKA 1234 WARSZAWA" };

  it("titleDedupBaseKey equals the previous inline JSON.stringify of [acct, date, amount, canonical(title)]", () => {
    const expected = JSON.stringify([
      "acc-1",
      fields.bookedAt,
      fields.amountMinor,
      canonicalizeForHash(fields.title),
    ]);
    expect(titleDedupBaseKey("acc-1", fields)).toBe(expected);
  });

  it("titleDedupHash equals computeDedupHash keyed on the title (byte-identical to the old inline call)", () => {
    const expected = computeDedupHash({
      accountId: "acc-1",
      bookedAt: fields.bookedAt,
      amountMinor: fields.amountMinor,
      rawDescription: fields.title,
      occurrence: 3,
    });
    expect(titleDedupHash("acc-1", fields, 3)).toBe(expected);
  });

  it("base key collapses case/whitespace in the title (same canonicalization as the hash)", () => {
    expect(titleDedupBaseKey("acc-1", { ...fields, title: "  biedronka 1234   warszawa " })).toBe(
      titleDedupBaseKey("acc-1", fields),
    );
  });
});
