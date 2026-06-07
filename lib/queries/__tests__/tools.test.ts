import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { Db } from "@/lib/supabase/admin";
import type { QueryTools } from "@/lib/ai/tools";
import { createQueryTools, withReadonlyFallback } from "@/lib/queries/tools";

// A db that explodes if touched — proves validation happens before any query.
const explodingDb = new Proxy({}, { get() { throw new Error("db should not be touched"); } }) as Db;

describe("createQueryTools input validation", () => {
  it("rejects an invalid totals.kind before hitting the db", async () => {
    const tools = createQueryTools(explodingDb);
    await expect(tools.totals({ period: "2026-05", kind: "bogus" } as never)).rejects.toThrow();
  });

  it("rejects a non-numeric list_transactions.limit before hitting the db", async () => {
    const tools = createQueryTools(explodingDb);
    await expect(tools.list_transactions({ limit: "lots" } as never)).rejects.toThrow();
  });
});

/** Build a QueryTools whose every method delegates to one impl. */
function toolsMock(impl: () => Promise<unknown>): QueryTools {
  const names = ["totals", "spend_by_category", "compare_periods", "top_merchants", "list_transactions"];
  const o: Record<string, () => Promise<unknown>> = {};
  for (const n of names) o[n] = impl;
  return o as unknown as QueryTools;
}

describe("withReadonlyFallback", () => {
  it("returns the primary result and never touches the fallback when the primary succeeds", async () => {
    const fallback = toolsMock(async () => { throw new Error("fallback must not run"); });
    const log = vi.fn();
    const tools = withReadonlyFallback(toolsMock(async () => ({ ok: "primary" })), fallback, log);
    await expect(tools.totals({ period: "2026-05" })).resolves.toEqual({ ok: "primary" });
    expect(log).not.toHaveBeenCalled();
  });

  it("falls back to the admin tools and logs once on an infra/auth failure", async () => {
    const primary = toolsMock(async () => { throw new Error("Invalid API key"); });
    const log = vi.fn();
    const tools = withReadonlyFallback(primary, toolsMock(async () => ({ ok: "fallback" })), log);
    await expect(tools.totals({ period: "2026-05" })).resolves.toEqual({ ok: "fallback" });
    expect(log).toHaveBeenCalledWith({ tool: "totals", error: "Invalid API key" });
  });

  it("surfaces the original readonly error (not the fallback's) when both paths fail", async () => {
    const primary = toolsMock(async () => { throw new Error("JWT rejected"); });
    const fallback = toolsMock(async () => { throw new Error("admin boom"); });
    const tools = withReadonlyFallback(primary, fallback, vi.fn());
    await expect(tools.totals({ period: "2026-05" })).rejects.toThrow("JWT rejected");
  });

  it("throws at construction if the fallback is missing a tool the primary has", () => {
    const primary = toolsMock(async () => ({}));
    const partial = { totals: async () => ({}) } as unknown as QueryTools;
    expect(() => withReadonlyFallback(primary, partial)).toThrow(/missing tool/i);
  });

  it("rethrows a Zod validation error without falling back, so the model can fix its args", async () => {
    const primary = toolsMock(async () => { throw new z.ZodError([]); });
    const fallback = toolsMock(async () => { throw new Error("fallback must not run"); });
    const log = vi.fn();
    const tools = withReadonlyFallback(primary, fallback, log);
    await expect(tools.totals({ period: "x" } as never)).rejects.toBeInstanceOf(z.ZodError);
    expect(log).not.toHaveBeenCalled();
  });
});
