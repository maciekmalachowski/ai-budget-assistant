# AI Budget Assistant — Phase 5B-1: Data & Query Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data-access and pure-computation foundation the backend API (5B-2) sits on: the DB repositories for every remaining table, the pure query/stat-pack layer (period parsing, aggregators, insight stat-pack builder, AI-category application), and the small `aiConfidence` extension that lets imports persist model confidence.

**Architecture:** Repositories are thin, fully-typed wrappers over an **injected** `Db` (`SupabaseClient<Database>`), exactly like the existing `lib/repos/transactions.ts` — so they're integration-tested against local Supabase via `createAdminClient()`. All number-crunching lives in **pure** functions under `lib/queries/` (and `lib/import/ai-apply.ts`) that take plain row arrays and return plain data, so they're unit-tested with no DB or API. Money stays in signed integer **minor units** throughout. Nothing here imports `server-only` except via the existing admin client, and no HTTP/route code is added (that's 5B-2).

**Tech Stack:** `@supabase/supabase-js` (typed queries), Vitest (unit `*.test.ts` + integration `*.itest.ts`), TypeScript strict. Reuses Phase 4 types (`InsightStatPack`, `CategorySuggestion`) and Phase 2 types (`TransactionDraft`, `MerchantRule`, `ColumnMapping`).

> **Phase context:** Phase 5B-1 of the 7-phase build. Phase 5 ("API + Auth") was split into **5A (auth & app shell — merged)** and **5B (backend API)**; 5B was further split into **5B-1 (this: data & query foundation)** and **5B-2 (QueryTools + import orchestration + insights service + `/api/*` routes)**. `main` has Phases 1–5A. Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` §6 (data model), §8 (AI mechanics — categorization confidence, Q&A tools, insights stat pack). **This phase ships no user-facing surface** — it's the tested library layer 5B-2 wires into routes. Local Supabase must be running (`npx supabase start`, Docker) with `.env.local` populated for the integration tests. The schema is already migrated (Phase 3); **no migrations are added here.**

> **Key schema facts (from the Phase 3 migrations) — do not re-derive:**
> - `transactions`: `amount_minor bigint` (signed), `ai_confidence real` (nullable), `category_source` ∈ `{rule,ai,user,uncategorized}`, FK `category_id → categories(id)`, `unique(account_id, dedup_hash)`.
> - `categories` seeded (12): `Groceries, Dining, Transport, Utilities, Housing, Health, Entertainment, Shopping, Subscriptions` (expense), `Income` (income), `Transfer` (transfer), `Other` (expense). `categories.name` is **unique**.
> - `merchant_map`: `match_type` ∈ `{exact,contains,regex}`, `source` ∈ `{user,ai,seed}`, FK `category_id`. **No unique constraint on `pattern`** → upserts must find-then-update/insert.
> - `import_batches.status` ∈ `{pending,mapped,imported,failed}`. `import_profiles.header_signature` is **unique**.
> - `insights.period_type` ∈ `{month,week}`, `period_start date`. **No unique constraint on `(period_type, period_start)`** → upserts must find-then-update/insert.

---

## Target File Structure (end of this phase)

```
lib/domain/types.ts                       # MODIFY: TransactionDraft += aiConfidence?
lib/repos/transactions.ts                 # MODIFY: insertDrafts persists ai_confidence; + range/list/update fns
lib/repos/__tests__/transactions.itest.ts # MODIFY: cover the new query/update fns

lib/queries/types.ts                      # TxnRow (shared pure-layer row shape)
lib/queries/period.ts                     # parsePeriod, previousMonth      (+ test)
lib/queries/aggregate.ts                  # totals, spendByCategory, topMerchants, deltaPct (+ test)
lib/queries/statpack.ts                   # buildStatPack -> InsightStatPack (+ test)
lib/import/ai-apply.ts                     # applyAiCategories (pure)         (+ test)

lib/repos/categories.ts                   # listCategories, getTaxonomy, getCategoryNameToId (+ itest)
lib/repos/merchantMap.ts                  # loadRules, upsertUserRule        (+ itest)
lib/repos/imports.ts                       # import batches + profiles        (+ itest)
lib/repos/insights.ts                      # getCachedInsight, upsertInsight, markPeriodStale (+ itest)
lib/repos/qaHistory.ts                     # logQa                            (+ itest)
lib/repos/accounts.ts                      # listAccounts, createAccount      (+ itest)
```

**Conventions:** `*.test.ts` = unit (run by `npm test`, no creds/Docker). `*.itest.ts` = integration (run by `npm run test:integration`, needs local Supabase + `.env.local`); follow the existing `transactions.itest.ts` style — `const db = createAdminClient()` at module top, `describe.sequential`, create test rows in `beforeAll`, clean up in `afterAll`. Each task ends with a commit; append the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Never commit `.env.local`.

---

## Task 1: Persist AI confidence on imported drafts

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/repos/transactions.ts`

- [ ] **Step 1: Add the optional field to `TransactionDraft`**

In `lib/domain/types.ts`, the `TransactionDraft` interface currently ends with `categorySource: CategorySource;`. Add one field (keep it optional so the Phase 2 pipeline and its tests are unaffected):

```ts
/** A ready-to-persist transaction (before DB insert / dedup against existing rows). */
export interface TransactionDraft {
  bookedAt: string;
  amountMinor: number;
  currency: string;
  rawDescription: string;
  merchant: string;
  dedupHash: string;
  categoryId: string | null;
  categorySource: CategorySource;
  /** Model confidence (0..1) when categorySource is "ai"; otherwise absent/null. */
  aiConfidence?: number | null;
}
```

- [ ] **Step 2: Persist it in `insertDrafts`**

In `lib/repos/transactions.ts`, the `rows` mapping inside `insertDrafts` builds the insert objects. Add the `ai_confidence` column:

```ts
  const rows = drafts.map((d) => ({
    account_id: accountId,
    booked_at: d.bookedAt,
    amount_minor: d.amountMinor,
    currency: d.currency,
    raw_description: d.rawDescription,
    merchant: d.merchant,
    category_id: d.categoryId,
    category_source: d.categorySource,
    ai_confidence: d.aiConfidence ?? null,
    import_batch_id: importBatchId,
    dedup_hash: d.dedupHash,
  }));
```

- [ ] **Step 3: Verify** — `npm run typecheck` → exit 0. `npm test` → existing unit tests still pass (the `pipeline` test is unaffected because the field is optional and the pipeline doesn't set it).

- [ ] **Step 4: Commit**

```bash
git add lib/domain/types.ts lib/repos/transactions.ts
git commit -m "feat(import): persist AI confidence on transaction drafts"
```

---

## Task 2: Period parsing (pure, TDD)

**Files:**
- Test: `lib/queries/__tests__/period.test.ts`
- Create: `lib/queries/period.ts`

- [ ] **Step 1: Write the failing test**

`lib/queries/__tests__/period.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parsePeriod, previousMonth } from "@/lib/queries/period";

describe("parsePeriod", () => {
  it("parses a whole month with correct last day and label", () => {
    expect(parsePeriod("2026-05")).toEqual({
      fromISO: "2026-05-01",
      toISO: "2026-05-31",
      label: "May 2026",
    });
  });

  it("handles February in leap and non-leap years", () => {
    expect(parsePeriod("2024-02").toISO).toBe("2024-02-29");
    expect(parsePeriod("2026-02").toISO).toBe("2026-02-28");
  });

  it("parses an inclusive day range", () => {
    expect(parsePeriod("2026-05-03..2026-05-10")).toEqual({
      fromISO: "2026-05-03",
      toISO: "2026-05-10",
      label: "2026-05-03 to 2026-05-10",
    });
  });

  it("throws on malformed input or a backwards range or bad month", () => {
    expect(() => parsePeriod("garbage")).toThrow();
    expect(() => parsePeriod("2026-13")).toThrow();
    expect(() => parsePeriod("2026-05-10..2026-05-03")).toThrow();
  });
});

describe("previousMonth", () => {
  it("steps back within a year and across the year boundary", () => {
    expect(previousMonth("2026-05")).toBe("2026-04");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });

  it("throws when given something that is not a month", () => {
    expect(() => previousMonth("2026-05-01")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/queries/__tests__/period.test.ts`
Expected: FAIL — cannot resolve `@/lib/queries/period`.

- [ ] **Step 3: Create `lib/queries/period.ts`**

```ts
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface PeriodBounds {
  /** Inclusive start date, "YYYY-MM-DD". */
  fromISO: string;
  /** Inclusive end date, "YYYY-MM-DD". */
  toISO: string;
  /** Human label, e.g. "May 2026" or "2026-05-03 to 2026-05-10". */
  label: string;
}

/**
 * Parse a period string into inclusive date bounds. Accepts a whole month
 * ("YYYY-MM") or an inclusive day range ("YYYY-MM-DD..YYYY-MM-DD"). Throws on
 * anything else, an out-of-range month, or a backwards range.
 */
export function parsePeriod(period: string): PeriodBounds {
  const trimmed = period.trim();

  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) {
    const year = Number(month[1]);
    const mon = Number(month[2]); // 1..12
    if (mon < 1 || mon > 12) throw new Error(`Invalid month in period: ${period}`);
    // Day 0 of the following month (1-indexed) = last day of this month.
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const mm = String(mon).padStart(2, "0");
    return {
      fromISO: `${year}-${mm}-01`,
      toISO: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
      label: `${MONTHS[mon - 1]} ${year}`,
    };
  }

  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (range) {
    const [, from, to] = range;
    if (from > to) throw new Error(`Period start after end: ${period}`);
    return { fromISO: from, toISO: to, label: `${from} to ${to}` };
  }

  throw new Error(`Unrecognized period format: ${period}`);
}

/** The "YYYY-MM" month immediately before a "YYYY-MM" month. Throws if not a month. */
export function previousMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) throw new Error(`Not a month: ${month}`);
  let year = Number(m[1]);
  let mon = Number(m[2]) - 1;
  if (mon === 0) {
    mon = 12;
    year -= 1;
  }
  return `${year}-${String(mon).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/queries/__tests__/period.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/period.ts lib/queries/__tests__/period.test.ts
git commit -m "feat(queries): period parsing (month + day-range)"
```

---

## Task 3: Aggregators + shared row type (pure, TDD)

**Files:**
- Create: `lib/queries/types.ts`
- Test: `lib/queries/__tests__/aggregate.test.ts`
- Create: `lib/queries/aggregate.ts`

- [ ] **Step 1: Create the shared row type `lib/queries/types.ts`**

```ts
/**
 * A flattened transaction row used by the pure aggregation layer.
 * `amountMinor` is signed integer minor units (negative = outflow, positive = inflow).
 * `categoryName` is the joined category name, or null when uncategorized.
 */
export interface TxnRow {
  amountMinor: number;
  merchant: string | null;
  currency: string;
  categoryName: string | null;
}
```

- [ ] **Step 2: Write the failing test**

`lib/queries/__tests__/aggregate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { totals, spendByCategory, topMerchants, deltaPct } from "@/lib/queries/aggregate";
import type { TxnRow } from "@/lib/queries/types";

const rows: TxnRow[] = [
  { amountMinor: -8740, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -2600, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -5000, merchant: "MPK", currency: "PLN", categoryName: "Transport" },
  { amountMinor: -1500, merchant: "ZZZ", currency: "PLN", categoryName: null },
  { amountMinor: 950000, merchant: "EMPLOYER", currency: "PLN", categoryName: "Income" },
];

describe("totals", () => {
  it("separates signed spend from income", () => {
    expect(totals(rows)).toEqual({
      totalSpentMinor: -17840,
      totalIncomeMinor: 950000,
      netMinor: 932160,
    });
  });
});

describe("spendByCategory", () => {
  it("groups expenses by category (uncategorized bucketed), most-spent first, ignoring income", () => {
    expect(spendByCategory(rows)).toEqual([
      { category: "Groceries", spentMinor: -11340 },
      { category: "Transport", spentMinor: -5000 },
      { category: "Uncategorized", spentMinor: -1500 },
    ]);
  });
});

describe("topMerchants", () => {
  it("ranks expense merchants by spend and respects the limit", () => {
    expect(topMerchants(rows, 2)).toEqual([
      { merchant: "BIEDRONKA", spentMinor: -11340 },
      { merchant: "MPK", spentMinor: -5000 },
    ]);
  });
});

describe("deltaPct", () => {
  it("computes percentage change on magnitudes and guards a zero base", () => {
    expect(deltaPct(1000, 1300)).toBe(30);
    expect(deltaPct(1000, 500)).toBe(-50);
    expect(deltaPct(0, 100)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run lib/queries/__tests__/aggregate.test.ts`
Expected: FAIL — cannot resolve `@/lib/queries/aggregate`.

- [ ] **Step 4: Create `lib/queries/aggregate.ts`**

```ts
import type { TxnRow } from "@/lib/queries/types";

export interface Totals {
  /** Sum of negative amounts (stays negative). */
  totalSpentMinor: number;
  /** Sum of positive amounts. */
  totalIncomeMinor: number;
  /** spent + income. */
  netMinor: number;
}

export function totals(rows: TxnRow[]): Totals {
  let spent = 0;
  let income = 0;
  for (const r of rows) {
    if (r.amountMinor < 0) spent += r.amountMinor;
    else income += r.amountMinor;
  }
  return { totalSpentMinor: spent, totalIncomeMinor: income, netMinor: spent + income };
}

export interface CategorySpend {
  category: string;
  spentMinor: number;
}

/** Expense (negative) totals grouped by category; uncategorized → "Uncategorized". Most-spent (most negative) first. */
export function spendByCategory(rows: TxnRow[]): CategorySpend[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.amountMinor >= 0) continue;
    const key = r.categoryName ?? "Uncategorized";
    map.set(key, (map.get(key) ?? 0) + r.amountMinor);
  }
  return [...map.entries()]
    .map(([category, spentMinor]) => ({ category, spentMinor }))
    .sort((a, b) => a.spentMinor - b.spentMinor);
}

export interface MerchantSpend {
  merchant: string;
  spentMinor: number;
}

/** Top expense merchants by spend; unknown merchant → "Unknown". */
export function topMerchants(rows: TxnRow[], limit = 5): MerchantSpend[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.amountMinor >= 0) continue;
    const key = r.merchant ?? "Unknown";
    map.set(key, (map.get(key) ?? 0) + r.amountMinor);
  }
  return [...map.entries()]
    .map(([merchant, spentMinor]) => ({ merchant, spentMinor }))
    .sort((a, b) => a.spentMinor - b.spentMinor)
    .slice(0, Math.max(0, limit));
}

/**
 * Percentage change from `from` to `to`, rounded to one decimal. Pass magnitudes
 * (non-negative) so "spending up 30%" reads as +30. Returns null when `from` is 0
 * (undefined change).
 */
export function deltaPct(from: number, to: number): number | null {
  if (from === 0) return null;
  return Math.round(((to - from) / Math.abs(from)) * 1000) / 10;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/queries/__tests__/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/types.ts lib/queries/aggregate.ts lib/queries/__tests__/aggregate.test.ts
git commit -m "feat(queries): pure spend aggregators over transaction rows"
```

---

## Task 4: Insight stat-pack builder (pure, TDD)

**Files:**
- Test: `lib/queries/__tests__/statpack.test.ts`
- Create: `lib/queries/statpack.ts`

The output type is the existing `InsightStatPack` from `lib/ai/insights.ts` (Phase 4): `{ periodLabel, currency, totalSpentMinor, totalIncomeMinor, byCategory: {category,spentMinor}[], vsPrevious: {category,deltaPct}[], topMerchants: {merchant,spentMinor}[], newMerchants: string[] }`.

- [ ] **Step 1: Write the failing test**

`lib/queries/__tests__/statpack.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildStatPack } from "@/lib/queries/statpack";
import type { TxnRow } from "@/lib/queries/types";

const current: TxnRow[] = [
  { amountMinor: -13000, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -5000, merchant: "MPK", currency: "PLN", categoryName: "Transport" },
  { amountMinor: -2000, merchant: "NETFLIX", currency: "PLN", categoryName: "Subscriptions" },
  { amountMinor: 950000, merchant: "EMPLOYER", currency: "PLN", categoryName: "Income" },
];
const previous: TxnRow[] = [
  { amountMinor: -10000, merchant: "BIEDRONKA", currency: "PLN", categoryName: "Groceries" },
  { amountMinor: -5000, merchant: "MPK", currency: "PLN", categoryName: "Transport" },
];

describe("buildStatPack", () => {
  it("assembles totals, category breakdown, period deltas, top merchants, and new merchants", () => {
    const pack = buildStatPack({ periodLabel: "May 2026", currency: "PLN", current, previous });

    expect(pack.periodLabel).toBe("May 2026");
    expect(pack.currency).toBe("PLN");
    expect(pack.totalSpentMinor).toBe(-20000);
    expect(pack.totalIncomeMinor).toBe(950000);
    expect(pack.byCategory).toEqual([
      { category: "Groceries", spentMinor: -13000 },
      { category: "Transport", spentMinor: -5000 },
      { category: "Subscriptions", spentMinor: -2000 },
    ]);
    // Groceries 10000 -> 13000 = +30%; Transport unchanged = 0%; Subscriptions absent in previous -> omitted.
    expect(pack.vsPrevious).toEqual([
      { category: "Groceries", deltaPct: 30 },
      { category: "Transport", deltaPct: 0 },
    ]);
    expect(pack.topMerchants[0]).toEqual({ merchant: "BIEDRONKA", spentMinor: -13000 });
    expect(pack.newMerchants).toEqual(["NETFLIX"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/queries/__tests__/statpack.test.ts`
Expected: FAIL — cannot resolve `@/lib/queries/statpack`.

- [ ] **Step 3: Create `lib/queries/statpack.ts`**

```ts
import type { TxnRow } from "@/lib/queries/types";
import type { InsightStatPack } from "@/lib/ai/insights";
import { totals, spendByCategory, topMerchants, deltaPct } from "@/lib/queries/aggregate";

/**
 * Build the compact stat pack handed to the insights model from the current
 * period's rows and the previous period's rows (for deltas / new merchants).
 * Pure: no DB, no I/O. Income is excluded from category/merchant breakdowns by
 * the aggregators (they only sum negative amounts).
 */
export function buildStatPack(input: {
  periodLabel: string;
  currency: string;
  current: TxnRow[];
  previous: TxnRow[];
}): InsightStatPack {
  const cur = totals(input.current);
  const byCategory = spendByCategory(input.current);

  const prevByCategory = new Map(
    spendByCategory(input.previous).map((c) => [c.category, c.spentMinor]),
  );
  const vsPrevious = byCategory
    .map((c) => {
      const prev = prevByCategory.get(c.category);
      if (prev === undefined) return null;
      const pct = deltaPct(Math.abs(prev), Math.abs(c.spentMinor));
      return pct === null ? null : { category: c.category, deltaPct: pct };
    })
    .filter((x): x is { category: string; deltaPct: number } => x !== null);

  const prevMerchants = new Set(input.previous.map((r) => r.merchant ?? "Unknown"));
  const newMerchants = [...new Set(input.current.map((r) => r.merchant ?? "Unknown"))].filter(
    (m) => !prevMerchants.has(m),
  );

  return {
    periodLabel: input.periodLabel,
    currency: input.currency,
    totalSpentMinor: cur.totalSpentMinor,
    totalIncomeMinor: cur.totalIncomeMinor,
    byCategory: byCategory.map((c) => ({ category: c.category, spentMinor: c.spentMinor })),
    vsPrevious,
    topMerchants: topMerchants(input.current, 5),
    newMerchants,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/queries/__tests__/statpack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/statpack.ts lib/queries/__tests__/statpack.test.ts
git commit -m "feat(queries): insight stat-pack builder"
```

---

## Task 5: Apply AI categories to drafts (pure, TDD)

**Files:**
- Test: `lib/import/__tests__/ai-apply.test.ts`
- Create: `lib/import/ai-apply.ts`

- [ ] **Step 1: Write the failing test**

`lib/import/__tests__/ai-apply.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { applyAiCategories, AI_CONFIDENCE_THRESHOLD } from "@/lib/import/ai-apply";
import type { TransactionDraft } from "@/lib/domain/types";
import type { CategorySuggestion } from "@/lib/ai/categorize";

function draft(over: Partial<TransactionDraft>): TransactionDraft {
  return {
    bookedAt: "2026-05-01",
    amountMinor: -1000,
    currency: "PLN",
    rawDescription: "x",
    merchant: "X",
    dedupHash: "h",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

const nameToId = new Map([
  ["Groceries", "cat-groceries"],
  ["Transport", "cat-transport"],
]);

describe("applyAiCategories", () => {
  it("leaves rule-categorized drafts untouched", () => {
    const d = draft({ merchant: "BIEDRONKA", categoryId: "cat-groceries", categorySource: "rule" });
    const sugg = new Map<string, CategorySuggestion>([
      ["BIEDRONKA", { id: "BIEDRONKA", category: "Transport", confidence: 0.99 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([d]);
  });

  it("applies a confident, in-taxonomy suggestion as category_source=ai", () => {
    const d = draft({ merchant: "BIEDRONKA" });
    const sugg = new Map<string, CategorySuggestion>([
      ["BIEDRONKA", { id: "BIEDRONKA", category: "Groceries", confidence: 0.9 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([
      { ...d, categoryId: "cat-groceries", categorySource: "ai", aiConfidence: 0.9 },
    ]);
  });

  it("leaves a low-confidence suggestion uncategorized but records the confidence", () => {
    const d = draft({ merchant: "ZZZ" });
    const sugg = new Map<string, CategorySuggestion>([
      ["ZZZ", { id: "ZZZ", category: "Groceries", confidence: 0.3 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([{ ...d, aiConfidence: 0.3 }]);
  });

  it("leaves off-taxonomy / Unknown suggestions uncategorized", () => {
    const d = draft({ merchant: "ZZZ" });
    const sugg = new Map<string, CategorySuggestion>([
      ["ZZZ", { id: "ZZZ", category: "Unknown", confidence: 0.95 }],
    ]);
    expect(applyAiCategories([d], sugg, nameToId)).toEqual([{ ...d, aiConfidence: 0.95 }]);
  });

  it("leaves a draft with no suggestion untouched", () => {
    const d = draft({ merchant: "NOSUGGEST" });
    expect(applyAiCategories([d], new Map(), nameToId)).toEqual([d]);
  });

  it("exposes a sane default threshold", () => {
    expect(AI_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(AI_CONFIDENCE_THRESHOLD).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/import/__tests__/ai-apply.test.ts`
Expected: FAIL — cannot resolve `@/lib/import/ai-apply`.

- [ ] **Step 3: Create `lib/import/ai-apply.ts`**

```ts
import type { TransactionDraft } from "@/lib/domain/types";
import type { CategorySuggestion } from "@/lib/ai/categorize";

/** Minimum model confidence to auto-apply an AI category; below this a row stays "needs review". */
export const AI_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Apply AI category suggestions to uncategorized drafts (pure). Drafts already
 * categorized by a rule are returned unchanged. For each uncategorized draft we
 * look up its merchant's suggestion; if the suggested category is in the taxonomy
 * (`nameToId`) and meets `threshold`, the draft becomes category_source="ai" with
 * that category and confidence. Otherwise the draft stays uncategorized, but a
 * present-but-rejected suggestion's confidence is recorded in `aiConfidence`
 * (so the UI can surface low-confidence rows as "needs review").
 */
export function applyAiCategories(
  drafts: TransactionDraft[],
  suggestionByMerchant: Map<string, CategorySuggestion>,
  nameToId: Map<string, string>,
  threshold = AI_CONFIDENCE_THRESHOLD,
): TransactionDraft[] {
  return drafts.map((d) => {
    if (d.categoryId) return d; // already set by a rule
    const sugg = d.merchant ? suggestionByMerchant.get(d.merchant) : undefined;
    if (!sugg) return d;

    const categoryId = nameToId.get(sugg.category);
    if (categoryId && sugg.confidence >= threshold) {
      return { ...d, categoryId, categorySource: "ai", aiConfidence: sugg.confidence };
    }
    return { ...d, aiConfidence: sugg.confidence };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/import/__tests__/ai-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/import/ai-apply.ts lib/import/__tests__/ai-apply.test.ts
git commit -m "feat(import): pure AI-category application with confidence gate"
```

---

## Task 6: Categories repository (integration)

**Files:**
- Create: `lib/repos/categories.ts`
- Create: `lib/repos/__tests__/categories.itest.ts`

- [ ] **Step 1: Create `lib/repos/categories.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";

export interface Category {
  id: string;
  name: string;
  kind: "expense" | "income" | "transfer";
  color: string | null;
}

/** All categories, ordered by name. */
export async function listCategories(db: Db): Promise<Category[]> {
  const { data, error } = await db
    .from("categories")
    .select("id, name, kind, color")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind as Category["kind"],
    color: c.color,
  }));
}

/** Category names only — the taxonomy passed to the AI categorizer. */
export async function getTaxonomy(db: Db): Promise<string[]> {
  return (await listCategories(db)).map((c) => c.name);
}

/** Map of category name → id, for turning category-name results into FKs. */
export async function getCategoryNameToId(db: Db): Promise<Map<string, string>> {
  return new Map((await listCategories(db)).map((c) => [c.name, c.id]));
}
```

- [ ] **Step 2: Create `lib/repos/__tests__/categories.itest.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCategories, getTaxonomy, getCategoryNameToId } from "@/lib/repos/categories";

const db = createAdminClient();

describe.sequential("categories repository (integration)", () => {
  it("lists the seeded categories with their kinds", async () => {
    const cats = await listCategories(db);
    const groceries = cats.find((c) => c.name === "Groceries");
    const income = cats.find((c) => c.name === "Income");
    expect(groceries?.kind).toBe("expense");
    expect(income?.kind).toBe("income");
    expect(cats.length).toBeGreaterThanOrEqual(12);
  });

  it("returns the taxonomy as a name list", async () => {
    const taxonomy = await getTaxonomy(db);
    expect(taxonomy).toContain("Groceries");
    expect(taxonomy).toContain("Transport");
  });

  it("maps names to ids", async () => {
    const map = await getCategoryNameToId(db);
    const id = map.get("Groceries");
    expect(typeof id).toBe("string");
    expect(id?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → the categories itest passes (plus existing itests). Requires local Supabase + `.env.local`.

- [ ] **Step 4: Commit**

```bash
git add lib/repos/categories.ts lib/repos/__tests__/categories.itest.ts
git commit -m "feat(repos): categories repository (taxonomy + name→id)"
```

---

## Task 7: Merchant-map repository (integration)

**Files:**
- Create: `lib/repos/merchantMap.ts`
- Create: `lib/repos/__tests__/merchantMap.itest.ts`

- [ ] **Step 1: Create `lib/repos/merchantMap.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";
import type { MerchantRule } from "@/lib/domain/types";

const MATCH_PRIORITY: Record<MerchantRule["matchType"], number> = {
  exact: 0,
  contains: 1,
  regex: 2,
};

/**
 * All categorization rules as domain MerchantRule[], ordered so the categorizer
 * tries exact rules before contains before regex (its first-match-wins loop
 * depends on this precedence).
 */
export async function loadRules(db: Db): Promise<MerchantRule[]> {
  const { data, error } = await db
    .from("merchant_map")
    .select("match_type, pattern, category_id")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => ({
      matchType: r.match_type as MerchantRule["matchType"],
      pattern: r.pattern,
      categoryId: r.category_id,
    }))
    .sort((a, b) => MATCH_PRIORITY[a.matchType] - MATCH_PRIORITY[b.matchType]);
}

/**
 * Record a learned rule from a manual correction. If a rule with the same
 * (pattern, match_type) exists, repoint it to the new category and mark it
 * user-sourced; otherwise insert a new user rule. Returns the rule id.
 * (merchant_map has no unique constraint on pattern, so this is find-then-write.)
 */
export async function upsertUserRule(
  db: Db,
  input: { pattern: string; matchType: MerchantRule["matchType"]; categoryId: string },
): Promise<string> {
  const { data: existing, error: selErr } = await db
    .from("merchant_map")
    .select("id")
    .eq("pattern", input.pattern)
    .eq("match_type", input.matchType)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  if (existing) {
    const { error } = await db
      .from("merchant_map")
      .update({ category_id: input.categoryId, source: "user" })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }

  const { data, error } = await db
    .from("merchant_map")
    .insert({
      pattern: input.pattern,
      match_type: input.matchType,
      category_id: input.categoryId,
      source: "user",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
```

- [ ] **Step 2: Create `lib/repos/__tests__/merchantMap.itest.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRules, upsertUserRule } from "@/lib/repos/merchantMap";
import { getCategoryNameToId } from "@/lib/repos/categories";

const db = createAdminClient();
const PATTERN = "ITEST_MERCHANT_MAP_PATTERN";
let groceriesId: string;
let transportId: string;

beforeAll(async () => {
  const map = await getCategoryNameToId(db);
  groceriesId = map.get("Groceries")!;
  transportId = map.get("Transport")!;
});

afterAll(async () => {
  await db.from("merchant_map").delete().eq("pattern", PATTERN);
});

describe.sequential("merchant_map repository (integration)", () => {
  it("inserts a new user rule, then updates it in place on repeat", async () => {
    const id1 = await upsertUserRule(db, { pattern: PATTERN, matchType: "contains", categoryId: groceriesId });
    const id2 = await upsertUserRule(db, { pattern: PATTERN, matchType: "contains", categoryId: transportId });
    expect(id2).toBe(id1); // same row, repointed

    const { data } = await db.from("merchant_map").select("category_id, source").eq("id", id1).single();
    expect(data?.category_id).toBe(transportId);
    expect(data?.source).toBe("user");
  });

  it("loadRules returns the rule as a domain MerchantRule and orders exact before contains", async () => {
    await upsertUserRule(db, { pattern: PATTERN, matchType: "exact", categoryId: groceriesId });
    const rules = await loadRules(db);
    const ours = rules.filter((r) => r.pattern === PATTERN);
    expect(ours.map((r) => r.matchType)).toEqual(["exact", "contains"]);
    expect(ours[0]).toEqual({ matchType: "exact", pattern: PATTERN, categoryId: groceriesId });
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → merchant_map itest passes.

- [ ] **Step 4: Commit**

```bash
git add lib/repos/merchantMap.ts lib/repos/__tests__/merchantMap.itest.ts
git commit -m "feat(repos): merchant_map repository (load rules + learn user rule)"
```

---

## Task 8: Transaction query/update repository extensions (integration)

**Files:**
- Modify: `lib/repos/transactions.ts`
- Modify: `lib/repos/__tests__/transactions.itest.ts`

- [ ] **Step 1: Add query/update functions to `lib/repos/transactions.ts`**

Add these imports at the top (alongside the existing `import type { Db }` and `TransactionDraft` imports):

```ts
import type { CategorySource } from "@/lib/domain/types";
import type { TxnRow } from "@/lib/queries/types";
import { getCategoryNameToId } from "@/lib/repos/categories";
```

Append to the end of the file:

```ts
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

/** Transactions booked within [fromISO, toISO] (inclusive), flattened for the pure aggregators. */
export async function getTransactionsInRange(
  db: Db,
  opts: { fromISO: string; toISO: string; accountId?: string },
): Promise<TxnRow[]> {
  let q = db
    .from("transactions")
    .select("amount_minor, merchant, currency, category:categories(name)")
    .gte("booked_at", opts.fromISO)
    .lte("booked_at", opts.toISO);
  if (opts.accountId) q = q.eq("account_id", opts.accountId);

  const { data, error } = await q.returns<
    { amount_minor: number; merchant: string | null; currency: string; category: { name: string } | null }[]
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    amountMinor: Number(r.amount_minor),
    merchant: r.merchant,
    currency: r.currency,
    categoryName: r.category?.name ?? null,
  }));
}

export interface TxnFilter {
  fromISO?: string;
  toISO?: string;
  /** Category name; an unknown name yields no rows. */
  category?: string;
  /** Case-insensitive merchant substring. */
  merchant?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  accountId?: string;
  /** Capped at 200; defaults to 50. */
  limit?: number;
}

export interface TxnListItem {
  id: string;
  bookedAt: string;
  amountMinor: number;
  currency: string;
  merchant: string | null;
  rawDescription: string;
  category: string | null;
}

/** Filtered, newest-first, row-capped transaction list (for the list_transactions Q&A tool and the table UI). */
export async function listTransactions(db: Db, filter: TxnFilter = {}): Promise<TxnListItem[]> {
  let categoryId: string | undefined;
  if (filter.category) {
    const nameToId = await getCategoryNameToId(db);
    categoryId = nameToId.get(filter.category);
    if (!categoryId) return []; // unknown category name → no matches
  }

  // Apply all filters first (filter builder), THEN order/limit (transform builder):
  // supabase-js filter methods (.gte/.eq/.ilike) are not available after .order()/.limit().
  let q = db
    .from("transactions")
    .select("id, booked_at, amount_minor, currency, merchant, raw_description, category:categories(name)");
  if (filter.fromISO) q = q.gte("booked_at", filter.fromISO);
  if (filter.toISO) q = q.lte("booked_at", filter.toISO);
  if (categoryId) q = q.eq("category_id", categoryId);
  if (filter.merchant) q = q.ilike("merchant", `%${filter.merchant}%`);
  if (filter.minAmountMinor !== undefined) q = q.gte("amount_minor", filter.minAmountMinor);
  if (filter.maxAmountMinor !== undefined) q = q.lte("amount_minor", filter.maxAmountMinor);
  if (filter.accountId) q = q.eq("account_id", filter.accountId);

  const { data, error } = await q
    .order("booked_at", { ascending: false })
    .limit(Math.min(filter.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX))
    .returns<
      {
        id: string;
        booked_at: string;
        amount_minor: number;
        currency: string;
        merchant: string | null;
        raw_description: string;
        category: { name: string } | null;
      }[]
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    bookedAt: r.booked_at,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    merchant: r.merchant,
    rawDescription: r.raw_description,
    category: r.category?.name ?? null,
  }));
}

/** Set a transaction's category + how it was decided. Clears ai_confidence (used for user/rule corrections). */
export async function updateTransactionCategory(
  db: Db,
  transactionId: string,
  categoryId: string | null,
  source: CategorySource,
): Promise<void> {
  const { error } = await db
    .from("transactions")
    .update({ category_id: categoryId, category_source: source, ai_confidence: null })
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Extend `lib/repos/__tests__/transactions.itest.ts`**

Add a new `describe.sequential` block at the end of the file (keep the existing tests as-is). It reuses the module-level `db` and seeds its own account so it's independent of the existing block:

```ts
import { getTransactionsInRange, listTransactions, updateTransactionCategory } from "@/lib/repos/transactions";
import { getCategoryNameToId } from "@/lib/repos/categories";

describe.sequential("transactions query/update (integration)", () => {
  let acctId: string;
  let groceriesId: string;

  beforeAll(async () => {
    const { data, error } = await db
      .from("accounts")
      .insert({ name: "ITEST query acct", currency: "PLN" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    acctId = data.id;
    groceriesId = (await getCategoryNameToId(db)).get("Groceries")!;

    await insertDrafts(db, acctId, null, [
      draft({ dedupHash: "q1", bookedAt: "2026-05-05", amountMinor: -8740, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
      draft({ dedupHash: "q2", bookedAt: "2026-05-20", amountMinor: -5000, merchant: "MPK", categoryId: null, categorySource: "uncategorized" }),
      draft({ dedupHash: "q3", bookedAt: "2026-04-30", amountMinor: -1200, merchant: "OLD", categoryId: null, categorySource: "uncategorized" }),
    ]);
  });

  afterAll(async () => {
    await db.from("accounts").delete().eq("id", acctId);
  });

  it("getTransactionsInRange returns only in-range rows with category names flattened", async () => {
    const rows = await getTransactionsInRange(db, { fromISO: "2026-05-01", toISO: "2026-05-31", accountId: acctId });
    expect(rows).toHaveLength(2);
    const biedronka = rows.find((r) => r.merchant === "BIEDRONKA");
    expect(biedronka?.categoryName).toBe("Groceries");
    expect(biedronka?.amountMinor).toBe(-8740);
  });

  it("listTransactions filters by merchant substring and caps/sorts results", async () => {
    const rows = await listTransactions(db, { accountId: acctId, merchant: "biedron" });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Groceries");
    expect(rows[0].bookedAt).toBe("2026-05-05");
  });

  it("listTransactions returns [] for an unknown category name", async () => {
    const rows = await listTransactions(db, { accountId: acctId, category: "NoSuchCategory" });
    expect(rows).toEqual([]);
  });

  it("updateTransactionCategory repoints a row and marks it user-sourced", async () => {
    const list = await listTransactions(db, { accountId: acctId, merchant: "MPK" });
    await updateTransactionCategory(db, list[0].id, groceriesId, "user");
    const after = await listTransactions(db, { accountId: acctId, merchant: "MPK" });
    expect(after[0].category).toBe("Groceries");
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → all transactions itests pass (original 4 + new 4).

- [ ] **Step 4: Commit**

```bash
git add lib/repos/transactions.ts lib/repos/__tests__/transactions.itest.ts
git commit -m "feat(repos): transaction range/list queries + category update"
```

---

## Task 9: Import batches + profiles repository (integration)

**Files:**
- Create: `lib/repos/imports.ts`
- Create: `lib/repos/__tests__/imports.itest.ts`

- [ ] **Step 1: Create `lib/repos/imports.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { ColumnMapping } from "@/lib/domain/types";

/** Create an import batch row (status defaults to "pending"); returns its id. */
export async function createImportBatch(
  db: Db,
  input: {
    accountId: string;
    fileName?: string | null;
    storagePath?: string | null;
    columnMapping?: ColumnMapping | null;
    rowCount?: number;
    status?: "pending" | "mapped" | "imported" | "failed";
  },
): Promise<string> {
  const { data, error } = await db
    .from("import_batches")
    .insert({
      account_id: input.accountId,
      file_name: input.fileName ?? null,
      storage_path: input.storagePath ?? null,
      column_mapping: (input.columnMapping ?? null) as unknown as Json,
      row_count: input.rowCount ?? 0,
      status: input.status ?? "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Update a batch's counts + terminal status after an import run. */
export async function finalizeImportBatch(
  db: Db,
  batchId: string,
  result: { rowCount: number; importedCount: number; duplicateCount: number; status: "imported" | "failed" },
): Promise<void> {
  const { error } = await db
    .from("import_batches")
    .update({
      row_count: result.rowCount,
      imported_count: result.importedCount,
      duplicate_count: result.duplicateCount,
      status: result.status,
    })
    .eq("id", batchId);
  if (error) throw new Error(error.message);
}

export interface ImportProfile {
  id: string;
  columnMapping: ColumnMapping;
  dateFormat: string | null;
  delimiter: string | null;
  decimalSep: string | null;
  encoding: string | null;
}

/** Look up a saved bank layout by its header fingerprint, or null if unknown. */
export async function getProfileBySignature(db: Db, headerSignature: string): Promise<ImportProfile | null> {
  const { data, error } = await db
    .from("import_profiles")
    .select("id, column_mapping, date_format, delimiter, decimal_sep, encoding")
    .eq("header_signature", headerSignature)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    columnMapping: data.column_mapping as unknown as ColumnMapping,
    dateFormat: data.date_format,
    delimiter: data.delimiter,
    decimalSep: data.decimal_sep,
    encoding: data.encoding,
  };
}

/** Create or update a bank layout profile keyed by header signature; returns its id. */
export async function saveProfile(
  db: Db,
  input: {
    headerSignature: string;
    columnMapping: ColumnMapping;
    dateFormat?: string | null;
    delimiter?: string | null;
    decimalSep?: string | null;
    encoding?: string | null;
  },
): Promise<string> {
  const { data, error } = await db
    .from("import_profiles")
    .upsert(
      {
        header_signature: input.headerSignature,
        column_mapping: input.columnMapping as unknown as Json,
        date_format: input.dateFormat ?? null,
        delimiter: input.delimiter ?? null,
        decimal_sep: input.decimalSep ?? null,
        encoding: input.encoding ?? null,
      },
      { onConflict: "header_signature" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
```

- [ ] **Step 2: Create `lib/repos/__tests__/imports.itest.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createImportBatch,
  finalizeImportBatch,
  getProfileBySignature,
  saveProfile,
} from "@/lib/repos/imports";
import type { ColumnMapping } from "@/lib/domain/types";

const db = createAdminClient();
const SIGNATURE = "ITEST_HEADER_SIGNATURE";
let acctId: string;

const mapping: ColumnMapping = {
  dateColumn: "Date",
  dateFormat: "YYYY-MM-DD",
  descriptionColumns: ["Description"],
  amount: { mode: "signed", amountColumn: "Amount" },
  decimalSep: ".",
  defaultCurrency: "PLN",
};

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST import acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId); // cascades batches
  await db.from("import_profiles").delete().eq("header_signature", SIGNATURE);
});

describe.sequential("imports repository (integration)", () => {
  it("creates a batch then finalizes its counts + status", async () => {
    const batchId = await createImportBatch(db, { accountId: acctId, fileName: "may.csv", rowCount: 3 });
    await finalizeImportBatch(db, batchId, { rowCount: 3, importedCount: 2, duplicateCount: 1, status: "imported" });
    const { data } = await db.from("import_batches").select("imported_count, duplicate_count, status").eq("id", batchId).single();
    expect(data).toEqual({ imported_count: 2, duplicate_count: 1, status: "imported" });
  });

  it("saves a profile and restores it by signature (round-trips the column mapping)", async () => {
    await saveProfile(db, { headerSignature: SIGNATURE, columnMapping: mapping, dateFormat: "YYYY-MM-DD", delimiter: ";", decimalSep: ".", encoding: "utf-8" });
    const restored = await getProfileBySignature(db, SIGNATURE);
    expect(restored?.columnMapping).toEqual(mapping);
    expect(restored?.delimiter).toBe(";");
  });

  it("upserts the profile in place on a second save (signature is unique)", async () => {
    const id1 = (await getProfileBySignature(db, SIGNATURE))!.id;
    await saveProfile(db, { headerSignature: SIGNATURE, columnMapping: mapping, delimiter: "," });
    const after = await getProfileBySignature(db, SIGNATURE);
    expect(after?.id).toBe(id1);
    expect(after?.delimiter).toBe(",");
  });

  it("returns null for an unknown signature", async () => {
    expect(await getProfileBySignature(db, "NOPE_NOT_A_SIGNATURE")).toBeNull();
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → imports itest passes.

- [ ] **Step 4: Commit**

```bash
git add lib/repos/imports.ts lib/repos/__tests__/imports.itest.ts
git commit -m "feat(repos): import batches + profiles repository"
```

---

## Task 10: Insights + qa_history repositories (integration)

**Files:**
- Create: `lib/repos/insights.ts`
- Create: `lib/repos/qaHistory.ts`
- Create: `lib/repos/__tests__/insights.itest.ts`

- [ ] **Step 1: Create `lib/repos/insights.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

export interface CachedInsight {
  id: string;
  summaryMd: string | null;
  stats: unknown;
  stale: boolean;
}

/** The cached insight for a period, or null if none exists. */
export async function getCachedInsight(
  db: Db,
  periodType: "month" | "week",
  periodStart: string,
): Promise<CachedInsight | null> {
  const { data, error } = await db
    .from("insights")
    .select("id, summary_md, stats, stale")
    .eq("period_type", periodType)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, summaryMd: data.summary_md, stats: data.stats, stale: data.stale };
}

/**
 * Store (or refresh) the cached insight for a period and mark it fresh.
 * (insights has no unique constraint on (period_type, period_start), so this is
 * find-then-update/insert.) Returns the insight id.
 */
export async function upsertInsight(
  db: Db,
  input: { periodType: "month" | "week"; periodStart: string; summaryMd: string; stats: unknown },
): Promise<string> {
  const existing = await getCachedInsight(db, input.periodType, input.periodStart);
  if (existing) {
    const { error } = await db
      .from("insights")
      .update({
        summary_md: input.summaryMd,
        stats: input.stats as Json,
        stale: false,
        generated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }
  const { data, error } = await db
    .from("insights")
    .insert({
      period_type: input.periodType,
      period_start: input.periodStart,
      summary_md: input.summaryMd,
      stats: input.stats as Json,
      stale: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Mark a period's cached insight stale (e.g. after new transactions land in it). No-op if none cached. */
export async function markPeriodStale(
  db: Db,
  periodType: "month" | "week",
  periodStart: string,
): Promise<void> {
  const { error } = await db
    .from("insights")
    .update({ stale: true })
    .eq("period_type", periodType)
    .eq("period_start", periodStart);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Create `lib/repos/qaHistory.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/** Append a Q&A interaction to the history log; returns the row id. */
export async function logQa(
  db: Db,
  input: { question: string; answerMd: string; toolCalls: unknown },
): Promise<string> {
  const { data, error } = await db
    .from("qa_history")
    .insert({
      question: input.question,
      answer_md: input.answerMd,
      tool_calls: input.toolCalls as Json,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
```

- [ ] **Step 3: Create `lib/repos/__tests__/insights.itest.ts`**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedInsight, upsertInsight, markPeriodStale } from "@/lib/repos/insights";
import { logQa } from "@/lib/repos/qaHistory";

const db = createAdminClient();
const PERIOD_START = "2099-01-01"; // far-future sentinel so it can't collide with real data
const qaIds: string[] = [];

afterAll(async () => {
  await db.from("insights").delete().eq("period_start", PERIOD_START);
  if (qaIds.length) await db.from("qa_history").delete().in("id", qaIds);
});

describe.sequential("insights + qa_history repositories (integration)", () => {
  it("inserts a cached insight, then updates it in place and clears stale", async () => {
    const id1 = await upsertInsight(db, { periodType: "month", periodStart: PERIOD_START, summaryMd: "first", stats: { a: 1 } });
    await markPeriodStale(db, "month", PERIOD_START);
    expect((await getCachedInsight(db, "month", PERIOD_START))?.stale).toBe(true);

    const id2 = await upsertInsight(db, { periodType: "month", periodStart: PERIOD_START, summaryMd: "second", stats: { a: 2 } });
    expect(id2).toBe(id1);
    const cached = await getCachedInsight(db, "month", PERIOD_START);
    expect(cached?.summaryMd).toBe("second");
    expect(cached?.stale).toBe(false);
    expect(cached?.stats).toEqual({ a: 2 });
  });

  it("returns null for an uncached period", async () => {
    expect(await getCachedInsight(db, "week", PERIOD_START)).toBeNull();
  });

  it("logs a Q&A interaction", async () => {
    const id = await logQa(db, { question: "how much on groceries?", answerMd: "4 820 zł", toolCalls: [{ name: "totals" }] });
    qaIds.push(id);
    const { data } = await db.from("qa_history").select("question, answer_md").eq("id", id).single();
    expect(data?.question).toBe("how much on groceries?");
    expect(data?.answer_md).toBe("4 820 zł");
  });
});
```

- [ ] **Step 4: Run** — `npm run test:integration` → insights/qa itest passes.

- [ ] **Step 5: Commit**

```bash
git add lib/repos/insights.ts lib/repos/qaHistory.ts lib/repos/__tests__/insights.itest.ts
git commit -m "feat(repos): insights cache + qa_history repositories"
```

---

## Task 11: Accounts repository (integration)

**Files:**
- Create: `lib/repos/accounts.ts`
- Create: `lib/repos/__tests__/accounts.itest.ts`

- [ ] **Step 1: Create `lib/repos/accounts.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";

export interface Account {
  id: string;
  name: string;
  currency: string;
}

/** All accounts, oldest first. */
export async function listAccounts(db: Db): Promise<Account[]> {
  const { data, error } = await db
    .from("accounts")
    .select("id, name, currency")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Create an account (currency defaults to PLN); returns its id. */
export async function createAccount(db: Db, input: { name: string; currency?: string }): Promise<string> {
  const { data, error } = await db
    .from("accounts")
    .insert({ name: input.name, currency: input.currency ?? "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
```

- [ ] **Step 2: Create `lib/repos/__tests__/accounts.itest.ts`**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAccounts, createAccount } from "@/lib/repos/accounts";

const db = createAdminClient();
let createdId: string;

afterAll(async () => {
  if (createdId) await db.from("accounts").delete().eq("id", createdId);
});

describe.sequential("accounts repository (integration)", () => {
  it("creates an account and lists it back", async () => {
    createdId = await createAccount(db, { name: "ITEST Revolut", currency: "EUR" });
    const accounts = await listAccounts(db);
    const mine = accounts.find((a) => a.id === createdId);
    expect(mine?.name).toBe("ITEST Revolut");
    expect(mine?.currency).toBe("EUR");
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → accounts itest passes.

- [ ] **Step 4: Commit**

```bash
git add lib/repos/accounts.ts lib/repos/__tests__/accounts.itest.ts
git commit -m "feat(repos): accounts repository"
```

---

## Task 12: Full verification

- [ ] **Step 1: Unit suite (no key, no Docker)** — `npm test`
Expected: all pass — the existing 64 plus the new pure-logic suites (`period`, `aggregate`, `statpack`, `ai-apply`); NO `*.itest.ts`/`*.smoke.ts` collected.

- [ ] **Step 2: Integration tier** — `npm run test:integration`
Expected: 0 failures. Includes the existing auth + transactions itests and the new repo itests (categories, merchant_map, transactions query/update, imports, insights/qa, accounts). Requires local Supabase + `.env.local`.

- [ ] **Step 3: typecheck / lint / build**

```bash
npm run typecheck   # exit 0
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"
```

- [ ] **Step 4: Commit anything outstanding (if not clean)**

```bash
git add -A -- ':!.env.local'
git commit -m "chore: phase 5b-1 verification" || echo "nothing to commit"
```

---

## Done when

- `npm test` passes (existing + new pure-logic suites) and collects no `*.itest.ts`/`*.smoke.ts`.
- `npm run test:integration` passes against local Supabase (all repo itests green).
- `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- The library layer exists and is tested: `aiConfidence` persisted on drafts; pure `parsePeriod`/`previousMonth`, `totals`/`spendByCategory`/`topMerchants`/`deltaPct`, `buildStatPack`, `applyAiCategories`; and DB repos for categories, merchant_map, transaction range/list/update, import batches/profiles, insights cache, qa_history, and accounts.

**Next:** Phase 5B-2 — Backend API: DB-backed `QueryTools` (`createQueryTools(db)`) wiring these repos + aggregators behind Zod-validated, row-capped tool inputs; the import orchestrator (`runImport`) chaining the Phase 2 pipeline → `loadRules` → `categorizeWithAI` → `applyAiCategories` → `insertDrafts` → `finalizeImportBatch`; the insights get-or-generate service (cache check → `getTransactionsInRange` current+previous → `buildStatPack` → `generateInsight` → `upsertInsight`); and the `/api/ask`, `/api/insights`, `/api/import` route handlers — all behind the Phase 5A auth lock.
