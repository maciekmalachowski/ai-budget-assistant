import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { runImport } from "@/lib/import/run";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

const db = createAdminClient();
let acctId: string;

const mapping: ColumnMapping = {
  dateColumn: "Date",
  dateFormat: "YYYY-MM-DD",
  descriptionColumns: ["Description"],
  amount: { mode: "signed", amountColumn: "Amount" },
  decimalSep: ".",
  defaultCurrency: "PLN",
};

const rows: RawRow[] = [
  { Date: "2026-05-02", Description: "BIEDRONKA 123", Amount: "-87.40" },
  { Date: "2026-05-03", Description: "BIEDRONKA 456", Amount: "-26.00" },
];

// Fake Anthropic: classifies the one unknown merchant ("BIEDRONKA 123" normalized) as Groceries.
function fakeAnthropic(category: string, confidence: number): Anthropic {
  const create = vi.fn().mockImplementation(async (args: { messages: { content: string }[] }) => {
    const items = JSON.parse(args.messages[0].content) as { id: string }[];
    return {
      content: [{ type: "text", text: JSON.stringify({ results: items.map((i) => ({ id: i.id, category, confidence })) }) }],
    };
  });
  return { messages: { create } } as unknown as Anthropic;
}

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST runImport acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
});

describe.sequential("runImport (integration)", () => {
  it("imports rows, AI-categorizes unknown merchants, and finalizes the batch", async () => {
    const summary = await runImport(
      { db, anthropic: fakeAnthropic("Groceries", 0.95) },
      { accountId: acctId, rows, mapping, fileName: "may.csv" },
    );
    expect(summary.inserted).toBe(2);
    expect(summary.duplicates).toBe(0);
    expect(summary.aiCategorized).toBe(2);

    const { data: batch } = await db.from("import_batches").select("status, imported_count").eq("id", summary.batchId).single();
    expect(batch).toEqual({ status: "imported", imported_count: 2 });

    const { data: txns } = await db.from("transactions").select("category_source, ai_confidence").eq("account_id", acctId);
    expect(txns?.every((t) => t.category_source === "ai")).toBe(true);
    expect(txns?.every((t) => t.ai_confidence === 0.95)).toBe(true);
  });

  it("is idempotent on re-import (all rows dedup as duplicates)", async () => {
    const summary = await runImport(
      { db, anthropic: fakeAnthropic("Groceries", 0.95) },
      { accountId: acctId, rows, mapping },
    );
    expect(summary.inserted).toBe(0);
    expect(summary.duplicates).toBe(2);
  });
});
