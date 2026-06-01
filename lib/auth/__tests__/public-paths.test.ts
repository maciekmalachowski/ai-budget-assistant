import { describe, it, expect } from "vitest";
import { isPublicPath } from "@/lib/auth/public-paths";

describe("isPublicPath", () => {
  it("treats the login page and its subpaths as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/")).toBe(true);
    expect(isPublicPath("/login/reset")).toBe(true);
  });

  it("treats the /auth namespace as public (reserved for future flows)", () => {
    expect(isPublicPath("/auth")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
  });

  it("gates everything else", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/transactions")).toBe(false);
    expect(isPublicPath("/api/ask")).toBe(false);
    expect(isPublicPath("/loginsomething")).toBe(false); // not a prefix boundary
  });
});
