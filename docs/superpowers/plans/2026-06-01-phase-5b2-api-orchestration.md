# AI Budget Assistant — Phase 5B-2: API & Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the 5B-1 data/query foundation into the actual backend behind the 5A auth lock: DB-backed `QueryTools` for Q&A, an end-to-end import orchestrator (rules → AI → dedup-insert), an insights get-or-generate service, and the `/api/ask`, `/api/insights`, `/api/import` route handlers.

**Architecture:** Three orchestration modules over **injected** deps (`db: Db`, `anthropic: Anthropic`) so they're integration-testable with a real local DB and a fake Anthropic client (no API key): `lib/queries/tools.ts` (`createQueryTools(db)` — Zod-validated, row-capped, read-only), `lib/import/run.ts` (`runImport`), `lib/insights/service.ts` (`getOrGenerateInsight`). Thin Next route handlers verify the session (defense-in-depth behind the middleware), then call those modules using the service-role admin client for DB work and the server-only Anthropic client. Money stays in signed integer minor units; the AI path degrades gracefully (import still succeeds if categorization fails).

**Tech Stack:** Next.js 15 App Router route handlers (Node runtime), `@anthropic-ai/sdk` (injected), Zod (input validation), Supabase (admin client), Vitest. Reuses everything from Phases 2–5B-1.

> **Phase context:** Phase 5B-2 of the 7-phase build — the final backend slice before UI. `main` has Phases 1–5B-1: scaffold; pure import/categorize engine; Supabase data model + repos; AI orchestration (`categorizeWithAI`, `answerQuestion`, `generateInsight`, `QA_TOOLS`/`QueryTools`); auth lock + session-aware clients (5A); and the data/query foundation (5B-1: repos for every table + pure `parsePeriod`/`previousMonth`, `totals`/`spendByCategory`/`topMerchants`/`deltaPct`, `buildStatPack`, `applyAiCategories`). Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` §7 (import flow), §8 (AI mechanics). Local Supabase must be running with `.env.local` populated for the integration tests. **No UI in this phase** (that's Phase 6); routes are verified by typecheck/build + the service-level integration tests.

> **Signatures already on `main` (do not re-derive):**
> - AI (`lib/ai/*`): `categorizeWithAI(client, items: {id,merchant,description,amountMinor}[], taxonomy: string[]) => Promise<{id,category,confidence}[]>`; `answerQuestion(client, question: string, tools: QueryTools, opts?) => Promise<{answer, toolCalls}>`; `generateInsight(client, statPack: InsightStatPack) => Promise<string>`; `getAnthropicClient()`; `QueryTools` interface (totals/spend_by_category/compare_periods/top_merchants/list_transactions, each `(input)=>Promise<unknown>`).
> - Repos (`lib/repos/*`, all take `db: Db`): `getTransactionsInRange(db,{fromISO,toISO,accountId?})`, `listTransactions(db, filter)`, `insertDrafts(db, accountId, batchId|null, drafts)`, `loadRules(db)`, `getTaxonomy(db)`, `getCategoryNameToId(db)`, `createImportBatch(db, input)`, `finalizeImportBatch(db, id, result)`, `getProfileBySignature(db, sig)`, `saveProfile(db, input)`, `getCachedInsight(db, type, start)`, `upsertInsight(db, input)`, `logQa(db, input)`.
> - Pure (`lib/queries/*`, `lib/import/*`): `parsePeriod(period)=>{fromISO,toISO,label}`, `previousMonth(month)`, `totals`/`spendByCategory`/`topMerchants`/`deltaPct`, `buildStatPack({periodLabel,currency,current,previous})`, `applyAiCategories(drafts, suggByMerchant, nameToId, threshold?)`.
> - CSV/domain: `parseCsvBuffer(buf, opts?) => {header, rows, encoding, delimiter}`, `headerSignature(header)`, `buildTransactionDrafts({accountId, rows, mapping, rules}) => {drafts, errors}`, `ColumnMapping` (has `dateFormat`, `decimalSep`), `createAdminClient()`, `createSupabaseServerClient()`.

---

## Target File Structure (end of this phase)

```
lib/queries/tools.ts                       # createQueryTools(db) -> QueryTools (Zod-validated)
lib/queries/__tests__/tools.test.ts        # unit: input validation rejects bad input
lib/queries/__tests__/tools.itest.ts       # integration: real DB-backed tool results
lib/import/run.ts                          # runImport(deps, input) -> ImportSummary
lib/import/__tests__/run.itest.ts          # integration: real DB + fake Anthropic
lib/insights/service.ts                    # getOrGenerateInsight(deps, input)
lib/insights/__tests__/service.itest.ts    # integration: real DB + fake Anthropic
lib/api/auth.ts                            # getAuthedUser() route guard
app/api/ask/route.ts                       # POST {question}
app/api/insights/route.ts                  # GET ?period=YYYY-MM
app/api/import/route.ts                    # POST multipart (file, accountId, mapping?)
```

**Conventions:** `npm test` = unit (no creds/Docker). `npm run test:integration` = `*.itest.ts` (local Supabase + `.env.local`). Integration tests inject a **fake** Anthropic client (`{ messages: { create } } as unknown as Anthropic`) so no API key is needed. Each task ends with a commit; append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Never commit `.env.local`. Use `git -c core.safecrlf=false commit` if CRLF warnings appear.

---

## Task 1: DB-backed QueryTools (Zod-validated)

**Files:**
- Create: `lib/queries/tools.ts`
- Test: `lib/queries/__tests__/tools.test.ts` (unit), `lib/queries/__tests__/tools.itest.ts` (integration)

- [ ] **Step 1: Create `lib/queries/tools.ts`**

```ts
import { z } from "zod";
import type { Db } from "@/lib/supabase/admin";
import type { QueryTools } from "@/lib/ai/tools";
import { parsePeriod } from "@/lib/queries/period";
import { totals, spendByCategory, topMerchants, deltaPct } from "@/lib/queries/aggregate";
import { getTransactionsInRange, listTransactions } from "@/lib/repos/transactions";

const totalsSchema = z.object({
  period: z.string(),
  kind: z.enum(["expense", "income"]).optional(),
  accountId: z.string().optional(),
});
const periodSchema = z.object({ period: z.string(), accountId: z.string().optional() });
const compareSchema = z.object({ metric: z.string(), periodA: z.string(), periodB: z.string() });
const topMerchantsSchema = z.object({
  period: z.string(),
  limit: z.number().int().positive().max(50).optional(),
});
const listSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  merchant: z.string().optional(),
  minAmountMinor: z.number().optional(),
  maxAmountMinor: z.number().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

/**
 * Real, DB-backed implementations of the read-only Q&A tools. Each validates its
 * input with Zod (throws on bad input — the Q&A loop captures that into the
 * tool_result), runs a parameterized read via the repos, and returns plain
 * JSON-serializable data (amounts are signed integer minor units). Never writes.
 */
export function createQueryTools(db: Db): QueryTools {
  return {
    totals: async (input) => {
      const { period, kind, accountId } = totalsSchema.parse(input);
      const { fromISO, toISO } = parsePeriod(period);
      const rows = await getTransactionsInRange(db, { fromISO, toISO, accountId });
      const t = totals(rows);
      if (kind === "expense") return { totalSpentMinor: t.totalSpentMinor };
      if (kind === "income") return { totalIncomeMinor: t.totalIncomeMinor };
      return t;
    },

    spend_by_category: async (input) => {
      const { period, accountId } = periodSchema.parse(input);
      const { fromISO, toISO } = parsePeriod(period);
      const rows = await getTransactionsInRange(db, { fromISO, toISO, accountId });
      return spendByCategory(rows);
    },

    compare_periods: async (input) => {
      const { metric, periodA, periodB } = compareSchema.parse(input);
      const a = parsePeriod(periodA);
      const b = parsePeriod(periodB);
      const rowsA = await getTransactionsInRange(db, { fromISO: a.fromISO, toISO: a.toISO });
      const rowsB = await getTransactionsInRange(db, { fromISO: b.fromISO, toISO: b.toISO });

      const valueFor = (rows: Awaited<ReturnType<typeof getTransactionsInRange>>): number => {
        const lower = metric.toLowerCase();
        if (lower === "income" || lower === "total_income") return totals(rows).totalIncomeMinor;
        if (lower === "expense" || lower === "total_expense") return totals(rows).totalSpentMinor;
        const cat = spendByCategory(rows).find((c) => c.category.toLowerCase() === lower);
        return cat ? cat.spentMinor : 0;
      };
      const valueA = valueFor(rowsA);
      const valueB = valueFor(rowsB);
      return { metric, periodA, periodB, valueA, valueB, deltaPct: deltaPct(Math.abs(valueA), Math.abs(valueB)) };
    },

    top_merchants: async (input) => {
      const { period, limit } = topMerchantsSchema.parse(input);
      const { fromISO, toISO } = parsePeriod(period);
      const rows = await getTransactionsInRange(db, { fromISO, toISO });
      return topMerchants(rows, limit ?? 5);
    },

    list_transactions: async (input) => {
      const f = listSchema.parse(input);
      return listTransactions(db, {
        fromISO: f.from,
        toISO: f.to,
        category: f.category,
        merchant: f.merchant,
        minAmountMinor: f.minAmountMinor,
        maxAmountMinor: f.maxAmountMinor,
        limit: f.limit,
      });
    },
  };
}
```

- [ ] **Step 2: Unit test (validation, no DB) — `lib/queries/__tests__/tools.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { Db } from "@/lib/supabase/admin";
import { createQueryTools } from "@/lib/queries/tools";

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
```

- [ ] **Step 3: Run the unit test** — `npx vitest run lib/queries/__tests__/tools.test.ts` → PASS (2 tests).

- [ ] **Step 4: Integration test — `lib/queries/__tests__/tools.itest.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createQueryTools } from "@/lib/queries/tools";
import { insertDrafts } from "@/lib/repos/transactions";
import { getCategoryNameToId } from "@/lib/repos/categories";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
const tools = createQueryTools(db);
let acctId: string;

function draft(over: Partial<TransactionDraft>): TransactionDraft {
  return {
    bookedAt: "2026-05-10",
    amountMinor: -1000,
    currency: "PLN",
    rawDescription: "x",
    merchant: "X",
    dedupHash: "d",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST tools acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  const groceriesId = (await getCategoryNameToId(db)).get("Groceries")!;
  await insertDrafts(db, acctId, null, [
    draft({ dedupHash: "tt1", bookedAt: "2026-05-05", amountMinor: -8000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
    draft({ dedupHash: "tt2", bookedAt: "2026-05-06", amountMinor: -2000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
    draft({ dedupHash: "tt3", bookedAt: "2026-05-07", amountMinor: 500000, merchant: "EMPLOYER", categoryId: null, categorySource: "uncategorized" }),
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
});

describe.sequential("createQueryTools (integration)", () => {
  it("totals splits spend vs income for the month", async () => {
    expect(await tools.totals({ period: "2026-05", accountId: acctId })).toEqual({
      totalSpentMinor: -10000,
      totalIncomeMinor: 500000,
      netMinor: 490000,
    });
  });

  it("totals can restrict to expense only", async () => {
    expect(await tools.totals({ period: "2026-05", kind: "expense", accountId: acctId })).toEqual({ totalSpentMinor: -10000 });
  });

  it("spend_by_category groups the month's expenses", async () => {
    const out = (await tools.spend_by_category({ period: "2026-05", accountId: acctId })) as { category: string; spentMinor: number }[];
    expect(out).toEqual([{ category: "Groceries", spentMinor: -10000 }]);
  });

  it("list_transactions filters by merchant", async () => {
    const out = (await tools.list_transactions({ merchant: "BIEDRONKA" })) as { merchant: string | null }[];
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((r) => r.merchant === "BIEDRONKA")).toBe(true);
  });
});
```

(`top_merchants`/`compare_periods` query the whole DB without an account filter, so they're left to the unit-validated path + manual use; the account-scoped tools above prove the wiring end-to-end.)

- [ ] **Step 5: Run** — `npm run test:integration` → tools itest passes.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/tools.ts lib/queries/__tests__/tools.test.ts lib/queries/__tests__/tools.itest.ts
git commit -m "feat(queries): DB-backed QueryTools for Q&A (Zod-validated, capped)"
```

---

## Task 2: Import orchestrator

**Files:**
- Create: `lib/import/run.ts`
- Test: `lib/import/__tests__/run.itest.ts`

- [ ] **Step 1: Create `lib/import/run.ts`**

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/lib/supabase/admin";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";
import { buildTransactionDrafts } from "@/lib/import/pipeline";
import { applyAiCategories } from "@/lib/import/ai-apply";
import { categorizeWithAI, type CategorizationItem, type CategorySuggestion } from "@/lib/ai/categorize";
import { loadRules } from "@/lib/repos/merchantMap";
import { getTaxonomy, getCategoryNameToId } from "@/lib/repos/categories";
import { insertDrafts } from "@/lib/repos/transactions";
import { createImportBatch, finalizeImportBatch } from "@/lib/repos/imports";

export interface RunImportInput {
  accountId: string;
  rows: RawRow[];
  mapping: ColumnMapping;
  fileName?: string | null;
}

export interface ImportSummary {
  batchId: string;
  rowCount: number;
  inserted: number;
  duplicates: number;
  aiCategorized: number;
  errors: { rowIndex: number; message: string }[];
}

/**
 * Run a CSV import end-to-end: open a batch, categorize by rules first, send only
 * the remaining unknown merchants to Claude in one batched call, apply the
 * confident suggestions, insert dedup-safely, and finalize the batch. AI failure
 * degrades gracefully — categorizeWithAI already returns all-"Unknown" on bad
 * output, and a thrown transport error is caught so the import still completes
 * (rows just stay uncategorized). A failure in the DB steps marks the batch failed.
 */
export async function runImport(deps: { db: Db; anthropic: Anthropic }, input: RunImportInput): Promise<ImportSummary> {
  const { db, anthropic } = deps;
  const batchId = await createImportBatch(db, {
    accountId: input.accountId,
    fileName: input.fileName ?? null,
    columnMapping: input.mapping,
    rowCount: input.rows.length,
    status: "mapped",
  });

  try {
    const rules = await loadRules(db);
    const { drafts, errors } = buildTransactionDrafts({
      accountId: input.accountId,
      rows: input.rows,
      mapping: input.mapping,
      rules,
    });

    const unknownMerchants = [
      ...new Set(drafts.filter((d) => !d.categoryId && d.merchant).map((d) => d.merchant)),
    ];

    let categorized = drafts;
    let aiCategorized = 0;
    if (unknownMerchants.length > 0) {
      const taxonomy = await getTaxonomy(db);
      const nameToId = await getCategoryNameToId(db);
      const items: CategorizationItem[] = unknownMerchants.map((m) => {
        const sample = drafts.find((d) => d.merchant === m)!;
        return { id: m, merchant: m, description: sample.rawDescription, amountMinor: sample.amountMinor };
      });

      let suggestions: CategorySuggestion[] = [];
      try {
        suggestions = await categorizeWithAI(anthropic, items, taxonomy);
      } catch {
        suggestions = []; // AI/transport failure → leave uncategorized; import still succeeds
      }
      const byMerchant = new Map(suggestions.map((s) => [s.id, s]));
      categorized = applyAiCategories(drafts, byMerchant, nameToId);
      aiCategorized = categorized.filter((d) => d.categorySource === "ai").length;
    }

    const { inserted, duplicates } = await insertDrafts(db, input.accountId, batchId, categorized);
    await finalizeImportBatch(db, batchId, {
      rowCount: input.rows.length,
      importedCount: inserted,
      duplicateCount: duplicates,
      status: "imported",
    });

    return { batchId, rowCount: input.rows.length, inserted, duplicates, aiCategorized, errors };
  } catch (err) {
    await finalizeImportBatch(db, batchId, {
      rowCount: input.rows.length,
      importedCount: 0,
      duplicateCount: 0,
      status: "failed",
    }).catch(() => {});
    throw err;
  }
}
```

- [ ] **Step 2: Integration test — `lib/import/__tests__/run.itest.ts`**

```ts
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
```

- [ ] **Step 3: Run** — `npm run test:integration` → run itest passes.

- [ ] **Step 4: Commit**

```bash
git add lib/import/run.ts lib/import/__tests__/run.itest.ts
git commit -m "feat(import): end-to-end import orchestrator (rules -> AI -> insert)"
```

---

## Task 3: Insights get-or-generate service

**Files:**
- Create: `lib/insights/service.ts`
- Test: `lib/insights/__tests__/service.itest.ts`

- [ ] **Step 1: Create `lib/insights/service.ts`**

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/lib/supabase/admin";
import { parsePeriod, previousMonth } from "@/lib/queries/period";
import { getTransactionsInRange } from "@/lib/repos/transactions";
import { buildStatPack } from "@/lib/queries/statpack";
import { generateInsight } from "@/lib/ai/insights";
import { getCachedInsight, upsertInsight } from "@/lib/repos/insights";

export interface InsightResult {
  period: string;
  summaryMd: string;
  stats: unknown;
  cached: boolean;
}

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";

/**
 * Return the cached monthly insight for a "YYYY-MM" period, generating + caching
 * it on a miss or when the cache is marked stale. Builds a compact stat pack
 * (current month vs previous month) and asks the model for a short narrative.
 */
export async function getOrGenerateInsight(
  deps: { db: Db; anthropic: Anthropic },
  input: { period: string; currency?: string },
): Promise<InsightResult> {
  const { db, anthropic } = deps;
  const { fromISO, toISO, label } = parsePeriod(input.period);
  const periodStart = fromISO;

  const cached = await getCachedInsight(db, "month", periodStart);
  if (cached && !cached.stale && cached.summaryMd) {
    return { period: input.period, summaryMd: cached.summaryMd, stats: cached.stats, cached: true };
  }

  const current = await getTransactionsInRange(db, { fromISO, toISO });
  const prev = parsePeriod(previousMonth(input.period));
  const previous = await getTransactionsInRange(db, { fromISO: prev.fromISO, toISO: prev.toISO });

  const statPack = buildStatPack({
    periodLabel: label,
    currency: input.currency ?? DEFAULT_CURRENCY,
    current,
    previous,
  });
  const summaryMd = await generateInsight(anthropic, statPack);
  await upsertInsight(db, { periodType: "month", periodStart, summaryMd, stats: statPack });

  return { period: input.period, summaryMd, stats: statPack, cached: false };
}
```

- [ ] **Step 2: Integration test — `lib/insights/__tests__/service.itest.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrGenerateInsight } from "@/lib/insights/service";
import { insertDrafts } from "@/lib/repos/transactions";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
let acctId: string;
const PERIOD = "2098-03"; // far-future sentinel month so it can't collide with real data
const PERIOD_START = "2098-03-01";

function draft(over: Partial<TransactionDraft>): TransactionDraft {
  return {
    bookedAt: "2098-03-10",
    amountMinor: -5000,
    currency: "PLN",
    rawDescription: "x",
    merchant: "X",
    dedupHash: "s",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

function fakeAnthropic() {
  const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "You spent a bit in March." }] });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST insights acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  await insertDrafts(db, acctId, null, [
    draft({ dedupHash: "is1", bookedAt: "2098-03-04", amountMinor: -12000, merchant: "BIEDRONKA" }),
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
  await db.from("insights").delete().eq("period_start", PERIOD_START);
});

describe.sequential("getOrGenerateInsight (integration)", () => {
  it("generates + caches on a miss, then serves from cache on the second call", async () => {
    const ai1 = fakeAnthropic();
    const first = await getOrGenerateInsight({ db, anthropic: ai1.client }, { period: PERIOD });
    expect(first.cached).toBe(false);
    expect(first.summaryMd).toContain("March");
    expect(ai1.create).toHaveBeenCalledTimes(1);

    const ai2 = fakeAnthropic();
    const second = await getOrGenerateInsight({ db, anthropic: ai2.client }, { period: PERIOD });
    expect(second.cached).toBe(true);
    expect(second.summaryMd).toBe(first.summaryMd);
    expect(ai2.create).not.toHaveBeenCalled(); // served from cache, no model call
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → service itest passes.

- [ ] **Step 4: Commit**

```bash
git add lib/insights/service.ts lib/insights/__tests__/service.itest.ts
git commit -m "feat(insights): cached get-or-generate insight service"
```

---

## Task 4: API auth guard + `/api/ask` route

**Files:**
- Create: `lib/api/auth.ts`
- Create: `app/api/ask/route.ts`

- [ ] **Step 1: Create `lib/api/auth.ts`**

```ts
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The authenticated user for the current request, or null. Route handlers use
 * this for defense-in-depth (the middleware already gates /api, but each route
 * also confirms a session before doing any work). Uses getUser(), which
 * revalidates the token with the auth server.
 */
export async function getAuthedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
```

- [ ] **Step 2: Create `app/api/ask/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnthropicClient } from "@/lib/ai/client";
import { answerQuestion } from "@/lib/ai/qa";
import { createQueryTools } from "@/lib/queries/tools";
import { logQa } from "@/lib/repos/qaHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ question: z.string().min(1).max(1000) });

export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "A non-empty 'question' (<=1000 chars) is required" }, { status: 400 });
  }

  const db = createAdminClient();
  try {
    const result = await answerQuestion(getAnthropicClient(), parsed.data.question, createQueryTools(db));
    await logQa(db, { question: parsed.data.question, answerMd: result.answer, toolCalls: result.toolCalls });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Sorry, I couldn't answer that. Please try rephrasing." }, { status: 502 });
  }
}
```

- [ ] **Step 3: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/api/auth.ts app/api/ask/route.ts
git commit -m "feat(api): /api/ask route (tool-calling Q&A, logged)"
```

---

## Task 5: `/api/insights` route

**Files:**
- Create: `app/api/insights/route.ts`

- [ ] **Step 1: Create `app/api/insights/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnthropicClient } from "@/lib/ai/client";
import { getOrGenerateInsight } from "@/lib/insights/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM");

export async function GET(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = new URL(request.url).searchParams.get("period");
  const parsed = periodSchema.safeParse(period);
  if (!parsed.success) {
    return NextResponse.json({ error: "Query param 'period' must be YYYY-MM" }, { status: 400 });
  }

  const db = createAdminClient();
  try {
    const result = await getOrGenerateInsight({ db, anthropic: getAnthropicClient() }, { period: parsed.data });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not generate insights for that period." }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/insights/route.ts
git commit -m "feat(api): /api/insights route (cached monthly insight)"
```

---

## Task 6: `/api/import` route

**Files:**
- Create: `app/api/import/route.ts`

- [ ] **Step 1: Create `app/api/import/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnthropicClient } from "@/lib/ai/client";
import { parseCsvBuffer } from "@/lib/csv/parse";
import { headerSignature } from "@/lib/csv/profile";
import { getProfileBySignature, saveProfile } from "@/lib/repos/imports";
import { runImport } from "@/lib/import/run";
import type { ColumnMapping } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import a CSV. Multipart form-data: `file` (the CSV), `accountId`, and optional
 * `mapping` (a JSON ColumnMapping). Mapping resolution: an explicit mapping wins
 * and is saved as the bank's profile; otherwise a known profile (matched by
 * header signature) is restored; otherwise we return `needs_mapping` with the
 * parsed header so the client can present the mapping step (Phase 6 wizard).
 */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  const accountId = form.get("accountId");
  if (!(file instanceof File) || typeof accountId !== "string" || !accountId) {
    return NextResponse.json({ error: "'file' and 'accountId' are required" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { header, rows, encoding, delimiter } = parseCsvBuffer(buf);
  const signature = headerSignature(header);
  const db = createAdminClient();

  let mapping: ColumnMapping;
  const mappingRaw = form.get("mapping");
  if (typeof mappingRaw === "string" && mappingRaw.length > 0) {
    try {
      mapping = JSON.parse(mappingRaw) as ColumnMapping;
    } catch {
      return NextResponse.json({ error: "'mapping' must be valid JSON" }, { status: 400 });
    }
    await saveProfile(db, {
      headerSignature: signature,
      columnMapping: mapping,
      dateFormat: mapping.dateFormat,
      delimiter,
      decimalSep: mapping.decimalSep,
      encoding,
    });
  } else {
    const profile = await getProfileBySignature(db, signature);
    if (!profile) {
      return NextResponse.json({ status: "needs_mapping", header, rowCount: rows.length, encoding, delimiter }, { status: 200 });
    }
    mapping = profile.columnMapping;
  }

  try {
    const summary = await runImport({ db, anthropic: getAnthropicClient() }, { accountId, rows, mapping, fileName: file.name });
    return NextResponse.json({ status: "imported", ...summary });
  } catch {
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/import/route.ts
git commit -m "feat(api): /api/import route (profile-aware CSV import)"
```

---

## Task 7: Full verification

- [ ] **Step 1: Unit suite** — `npm test`
Expected: all pass (prior + the new `tools.test.ts` validation suite); NO `*.itest.ts`/`*.smoke.ts` collected.

- [ ] **Step 2: Integration tier** — `npm run test:integration`
Expected: 0 failures. Includes all prior itests plus the new `tools.itest.ts`, `run.itest.ts`, `service.itest.ts` (the AI-dependent ones inject a fake Anthropic — no API key needed). Requires local Supabase + `.env.local`.

- [ ] **Step 3: typecheck / lint / build**

```bash
npm run typecheck   # exit 0
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"; /api/ask, /api/insights, /api/import appear as ƒ (Dynamic) route handlers
```

- [ ] **Step 4: Commit anything outstanding (if not clean)**

```bash
git add -A -- ':!.env.local'
git commit -m "chore: phase 5b-2 verification" || echo "nothing to commit"
```

---

## Done when

- `npm test` passes (incl. the QueryTools validation unit test) and collects no `*.itest.ts`/`*.smoke.ts`.
- `npm run test:integration` passes against local Supabase, with `createQueryTools`, `runImport`, and `getOrGenerateInsight` exercised end-to-end (real DB + injected fake Anthropic).
- `npm run typecheck`, `npm run lint`, `npm run build` all pass; the three route handlers compile.
- The backend is complete behind the auth lock: tool-calling Q&A (`/api/ask`), cached insights (`/api/insights`), and profile-aware CSV import with rules→AI categorization (`/api/import`).

**Note (route-level testing):** the route handlers are intentionally thin — all real logic lives in `createQueryTools`/`runImport`/`getOrGenerateInsight`, which have integration tests. The routes themselves call `getAnthropicClient()` (real API) and `getAuthedUser()` (request cookies), so they're verified by typecheck/build here and exercised for real once the Phase 6 UI calls them (an optional Playwright/smoke pass can be added then).

**Production note (Phase 7):** a dedicated read-only DB role for the Q&A path (spec §10/§11) remains deferred — routes currently use the service-role admin client after the auth gate, which is acceptable for a single-user app. Adding unique constraints on `merchant_map(pattern,match_type)` and `insights(period_type,period_start)` (to replace find-then-write with native upserts) is also a sound future migration.

**Next:** Phase 6 — UI: the dashboard (KPI cards, spend-by-category donut, trend, recent transactions), the transactions table with inline category editing (which calls a correction action that learns a `merchant_map` rule), the insights feed, the import wizard (upload → map → review, driven by `/api/import`'s `needs_mapping` response), the Ask slide-over panel (`/api/ask`), and settings — all behind the 5A login.
