import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, importTooLarge } from "@/lib/import/limits";

describe("importTooLarge", () => {
  it("is false at or below the cap", () => {
    expect(importTooLarge(0)).toBe(false);
    expect(importTooLarge(MAX_IMPORT_BYTES)).toBe(false);
  });
  it("is true above the cap", () => {
    expect(importTooLarge(MAX_IMPORT_BYTES + 1)).toBe(true);
  });
  it("caps at 4 MB", () => {
    expect(MAX_IMPORT_BYTES).toBe(4 * 1024 * 1024);
  });
});
