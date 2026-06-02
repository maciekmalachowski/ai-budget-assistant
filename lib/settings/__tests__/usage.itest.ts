import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsageStats } from "@/lib/settings/usage";

describe("getUsageStats (integration)", () => {
  it("returns non-negative counts", async () => {
    const stats = await getUsageStats(createAdminClient());
    expect(stats.qaCount).toBeGreaterThanOrEqual(0);
    expect(stats.insightCount).toBeGreaterThanOrEqual(0);
  });
});
