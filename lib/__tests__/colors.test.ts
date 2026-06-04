import { describe, it, expect } from "vitest";
import { categoryColor, swatchColor, CATEGORY_PALETTE, NO_CATEGORY_COLOR } from "@/lib/colors";

describe("categoryColor", () => {
  it("returns the saved color when present", () => {
    expect(categoryColor("Groceries", 0, { Groceries: "#34c759" })).toBe("#34c759");
  });

  it("falls back to a deterministic palette color by index when unset", () => {
    expect(categoryColor("Mystery", 1, {})).toBe(CATEGORY_PALETTE[1]);
    expect(categoryColor("Mystery", 0, { Mystery: null })).toBe(CATEGORY_PALETTE[0]);
  });

  it("wraps the palette by index", () => {
    const i = CATEGORY_PALETTE.length + 2;
    expect(categoryColor("X", i, {})).toBe(CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]);
  });
});

describe("swatchColor", () => {
  it("returns the saved color for a named category", () => {
    expect(swatchColor("Dining", { Dining: "#ff9f0a" })).toBe("#ff9f0a");
  });

  it("returns the no-category grey for null/unknown", () => {
    expect(swatchColor(null, {})).toBe(NO_CATEGORY_COLOR);
    expect(swatchColor("Ghost", {})).toBe(NO_CATEGORY_COLOR);
    expect(swatchColor("Ghost", { Ghost: null })).toBe(NO_CATEGORY_COLOR);
  });
});
