import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { __mintReadonlyJwt } from "@/lib/supabase/readonly";

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

describe("mintReadonlyJwt", () => {
  const secret = "test-secret-at-least-32-characters-long!!";

  it("produces an HS256 JWT with role=readonly_qa", () => {
    const token = __mintReadonlyJwt(secret);
    const [header, payload] = token.split(".");
    expect(decodeSegment(header)).toEqual({ alg: "HS256", typ: "JWT" });
    const claims = decodeSegment(payload);
    expect(claims.role).toBe("readonly_qa");
    expect(typeof claims.exp).toBe("number");
  });

  it("signs the header.payload with the secret (HMAC-SHA256, base64url)", () => {
    const token = __mintReadonlyJwt(secret);
    const [header, payload, sig] = token.split(".");
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    expect(sig).toBe(expected);
  });
});
