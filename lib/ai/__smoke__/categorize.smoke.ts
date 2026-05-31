import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { categorizeWithAI } from "@/lib/ai/categorize";

const hasKey = !!process.env.ANTHROPIC_API_KEY;

// Auto-skips when no key is present, so `npm run test:smoke` passes cleanly
// in credential-free environments. Provide ANTHROPIC_API_KEY in .env.local to run it.
describe.skipIf(!hasKey)("categorizeWithAI (real API)", () => {
  it("classifies an obvious grocery transaction", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const out = await categorizeWithAI(
      client,
      [{ id: "t1", merchant: "BIEDRONKA", description: "BIEDRONKA 1234 WARSZAWA", amountMinor: -8740 }],
      ["Groceries", "Transport", "Dining", "Utilities"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("t1");
    expect(out[0].category).toBe("Groceries");
  });
});
