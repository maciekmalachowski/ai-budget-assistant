import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { runImport } from "@/lib/import/run";
import { buildTransactionDrafts } from "@/lib/import/pipeline";
import { backfillMerchants } from "@/lib/transactions/backfillMerchants";
import { applyCorrection } from "@/lib/transactions/correct";
import { seedMerchantRules, loadRules } from "@/lib/repos/merchantMap";
import { getCategoryNameToId } from "@/lib/repos/categories";
import { listTransactions } from "@/lib/repos/transactions";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

/**
 * Task-9 end-to-end integration test (plan 2026-06-04). Imports a fixture cut from real
 * Santander rows through the WHOLE pipeline (classify → extract → seed-rule → AI fallback →
 * learn) and asserts: merchant names, resolved categories, learned-rule persistence for a
 * confident AI merchant, NO learned rule for person-to-person transfers, and backfill
 * idempotency (a user correction survives a rerun). The AI is faked (deterministic, no key).
 */

const db = createAdminClient();
let acctId: string;

// Fixed Santander layout: title in col 3, counterparty name in col 4, IBAN in col 5, signed amount in col 6.
const MAPPING: ColumnMapping = {
  dateColumn: "Column 1",
  dateFormat: "DD-MM-YYYY",
  descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4",
  counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

const row = (date: string, title: string, cp: string, iban: string, amount: string): RawRow => ({
  "Column 1": date,
  "Column 3": title,
  "Column 4": cp,
  "Column 5": iban,
  "Column 6": amount,
});

// Real-shaped rows cut from the user's Santander exports.
const CARD_BIEDRONKA = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 19.16 PLN JMP S.A. BIEDRONKA 4014 BIALYSTOK";
const CARD_ZABKA = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 5.99 PLN ZABKA Z9241 K.1 GDANSK";
const CARD_UNKNOWN = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 87.00 PLN MB&SJ COMPANY GDANSK";
const TRANSFER_TITLE = "Przelew na telefon Od: 48604263864 Do: 485*****130";
// The brand the card extractor actually yields for CARD_UNKNOWN (no store# before the city, so the
// city is kept) — this is the exact key the AI-learning path uses as the rule pattern.
const UNKNOWN_MERCHANT = "MB&SJ COMPANY GDANSK";

const ROWS: RawRow[] = [
  row("31-05-2026", CARD_BIEDRONKA, "", "", "-19,16"),
  row("31-05-2026", CARD_ZABKA, "", "", "-5,99"),
  row("31-05-2026", CARD_UNKNOWN, "", "", "-87,00"),
  row("31-05-2026", TRANSFER_TITLE, "JULIA ZAKRZEWSKA", "PL18 1020 1752 0000 0102 0167 4100", "70,00"),
];

/**
 * AI fake that resolves a category per merchant id (unlike the shared single-category fake).
 * Returns the matching {category, confidence}, or "Unknown"/0 for anything not in the map —
 * exercising the same JSON contract the real client returns.
 */
function fakeAnthropicByMerchant(map: Record<string, { category: string; confidence: number }>): Anthropic {
  const create = vi.fn().mockImplementation(async (args: { messages: { content: string }[] }) => {
    const items = JSON.parse(args.messages[0].content) as { id: string }[];
    const results = items.map((i) => ({
      id: i.id,
      category: map[i.id]?.category ?? "Unknown",
      confidence: map[i.id]?.confidence ?? 0,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
  });
  return { messages: { create } } as unknown as Anthropic;
}

beforeAll(async () => {
  const { data, error } = await db
    .from("accounts")
    .insert({ name: `ITEST extraction-cat ${Date.now()}`, currency: "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  acctId = data.id;

  // Load the seed dictionary so card brands resolve by rule (idempotent across other itests).
  await seedMerchantRules(db);
});

afterAll(async () => {
  // Clean up the AI-learned rule + the unknown-card user correction this test created.
  await db.from("merchant_map").delete().eq("pattern", UNKNOWN_MERCHANT);
  await db.from("transactions").delete().eq("account_id", acctId);
  await db.from("accounts").delete().eq("id", acctId);
});

describe.sequential("extraction + categorization end-to-end (integration)", () => {
  it("extracts merchants, resolves categories, and learns a rule for a confident AI merchant", async () => {
    const anthropic = fakeAnthropicByMerchant({
      // Person-to-person transfer: Transfer, confident — must NOT be learned.
      "Julia Zakrzewska": { category: "Transfer", confidence: 0.99 },
      // Unknown real merchant (card): Shopping, confident — MUST be learned as an exact rule.
      [UNKNOWN_MERCHANT]: { category: "Shopping", confidence: 0.95 },
    });

    const summary = await runImport(
      { db, anthropic },
      { accountId: acctId, rows: ROWS, mapping: MAPPING, fileName: "santander-fixture.csv" },
    );
    expect(summary.inserted).toBe(4);
    expect(summary.duplicates).toBe(0);

    const txns = await listTransactions(db, { accountId: acctId, limit: 50 });
    const byMerchant = new Map(txns.map((t) => [t.merchant, t]));

    // --- Merchant extraction (the headline names) ---
    const biedronka = txns.find((t) => t.rawDescription === CARD_BIEDRONKA)!;
    const zabka = txns.find((t) => t.rawDescription === CARD_ZABKA)!;
    expect(biedronka.merchant).toContain("BIEDRONKA"); // "JMP S.A. BIEDRONKA 4014" → BIEDRONKA brand
    expect(zabka.merchant).toContain("ZABKA"); // "ZABKA Z9241 K.1 GDANSK" → ZABKA brand
    const julia = byMerchant.get("Julia Zakrzewska");
    expect(julia).toBeTruthy(); // phone transfer payee recovered from col 4, Title-Cased
    expect(julia!.rawDescription).toContain("JULIA ZAKRZEWSKA"); // full line preserved

    // --- Resolved categories ---
    // BIEDRONKA / ZABKA resolve via the seed `contains` rules (no AI needed).
    expect(biedronka.category).toBe("Groceries");
    expect(biedronka.categorySource).toBe("rule");
    expect(zabka.category).toBe("Groceries");
    expect(zabka.categorySource).toBe("rule");
    // The transfer is AI-categorized as Transfer (confident).
    expect(julia!.category).toBe("Transfer");
    expect(julia!.categorySource).toBe("ai");
    // The unknown card merchant is AI-categorized as Shopping.
    const unknown = txns.find((t) => t.rawDescription === CARD_UNKNOWN)!;
    expect(unknown.category).toBe("Shopping");
    expect(unknown.categorySource).toBe("ai");

    // --- Learned-rule persistence (AI confidence ≥ 0.8 upserts a merchant_map rule) ---
    // The confident card merchant gets a remembered exact rule…
    const { data: learned } = await db
      .from("merchant_map")
      .select("match_type, source, category_id")
      .eq("pattern", UNKNOWN_MERCHANT);
    expect(learned!.length).toBe(1);
    expect(learned![0].match_type).toBe("exact");
    expect(learned![0].source).toBe("ai");

    // …but the person-to-person transfer must NOT be learned (its category varies per txn).
    const { data: notLearned } = await db
      .from("merchant_map")
      .select("id")
      .eq("pattern", "Julia Zakrzewska");
    expect(notLearned!.length).toBe(0);
  }, 30000);

  it("re-import is idempotent (all rows dedup) and the learned rule resolves the merchant without the AI", async () => {
    // An AI fake that returns Unknown for everything: if categorization fell back to the AI for the
    // now-learned merchant it would be Unknown, not Shopping. Because all rows dedup AND the learned
    // exact rule already categorizes the merchant by rule, the import stays correct without the AI.
    const anthropic = fakeAnthropicByMerchant({});
    const summary = await runImport(
      { db, anthropic },
      { accountId: acctId, rows: ROWS, mapping: MAPPING },
    );
    expect(summary.inserted).toBe(0);
    expect(summary.duplicates).toBe(4);

    // Build drafts the same way the importer does, with the learned rule loaded: the merchant now
    // resolves by RULE (source 'rule', no AI) — proving the AI guess was remembered.
    const rules = await loadRules(db);
    const { drafts } = buildTransactionDrafts({
      accountId: acctId,
      rows: [row("31-05-2026", CARD_UNKNOWN, "", "", "-87,00")],
      mapping: MAPPING,
      rules,
    });
    expect(drafts[0].categorySource).toBe("rule");
    const nameToId = await getCategoryNameToId(db);
    expect(drafts[0].categoryId).toBe(nameToId.get("Shopping"));

    // The originally-imported row is still Shopping (unchanged by the dedup'd re-import).
    const txns = await listTransactions(db, { accountId: acctId, limit: 50 });
    const unknown = txns.find((t) => t.rawDescription === CARD_UNKNOWN)!;
    expect(unknown.category).toBe("Shopping");
  }, 30000);

  it("backfill is idempotent and preserves a user correction across reruns", async () => {
    // The user re-categorizes the BIEDRONKA row to Dining by hand (source='user').
    const txns = await listTransactions(db, { accountId: acctId, limit: 50 });
    const biedronka = txns.find((t) => t.rawDescription === CARD_BIEDRONKA)!;
    expect(biedronka.merchant).toBeTruthy(); // a card line always yields a merchant
    const biedronkaMerchant = biedronka.merchant as string;
    await applyCorrection(db, {
      transactionId: biedronka.id,
      merchant: biedronkaMerchant,
      categoryName: "Dining",
    });

    // Backfill twice. The user row keeps category 'Dining' + source 'user'; merchant refreshed.
    await backfillMerchants(db);
    await backfillMerchants(db);

    const after = await listTransactions(db, { accountId: acctId, limit: 50 });
    const biedronkaAfter = after.find((t) => t.rawDescription === CARD_BIEDRONKA)!;
    expect(biedronkaAfter.category).toBe("Dining");
    expect(biedronkaAfter.categorySource).toBe("user");

    // A non-user row (ZABKA) is still rule-categorized as Groceries after backfill.
    const zabkaAfter = after.find((t) => t.rawDescription === CARD_ZABKA)!;
    expect(zabkaAfter.category).toBe("Groceries");
    expect(zabkaAfter.categorySource).toBe("rule");

    // Clean up the user rule learned by applyCorrection (keyed on the BIEDRONKA brand merchant).
    await db.from("merchant_map").delete().eq("pattern", biedronkaMerchant).eq("source", "user");
  }, 30000);
});
