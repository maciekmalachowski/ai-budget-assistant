import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges conflicting tailwind classes, keeping the last", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values and joins the rest", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
});
