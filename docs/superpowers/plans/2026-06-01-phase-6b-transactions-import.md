# AI Budget Assistant — Phase 6B: Transactions + Import Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core data-management loop in the UI: a filterable/searchable **Transactions** table with inline category editing that *learns* (each correction updates the row to `user` source and upserts a `merchant_map` rule), plus a 3-step **Import wizard** (upload + pick account → map columns → review) driven by the existing `/api/import` `needs_mapping` flow.

**Architecture:** Reads happen in server components via existing repos; the testable mutation logic (`applyCorrection`) lives in a plain module over an injected `db` (integration-tested) and is wrapped by a thin `"use server"` action that adds `revalidatePath`. The transactions table and the import wizard are client components; filters are URL-search-param driven so the server page re-fetches on navigation. The import wizard holds the chosen `File` in state and talks to `/api/import` via `fetch(FormData)`, rendering the column-mapping form only when the server responds `needs_mapping`.

**Tech Stack:** Next.js 15 (server components + server actions + `revalidatePath`, client components with `useTransition`/`useState`), React 19, Tailwind v4, Vitest. No new dependencies. Money in signed integer minor units (display via `formatMoneyMinor`).

> **Phase context:** Phase 6B of the 7-phase build (Phase 6 split 3 ways: 6A app shell + dashboard — **merged**; 6B this; 6C insights + Ask panel + settings). `main` has Phases 1–6A. This replaces the placeholder `app/(app)/transactions/page.tsx` and `app/(app)/import/page.tsx` from 6A. Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` §9 (Transactions: filterable table, inline category editing that trains `merchant_map`, "Needs review" filter; Import: 3-step wizard) and §7 (import flow). Local Supabase must be running with `.env.local` for the integration tests.

> **Signatures already on `main` (do not re-derive):**
> - `lib/repos/transactions.ts`: `listTransactions(db, filter) => TxnListItem[]` (extended in Task 1), `updateTransactionCategory(db, transactionId, categoryId|null, source)`.
> - `lib/repos/categories.ts`: `listCategories(db) => {id,name,kind,color}[]`, `getCategoryNameToId(db) => Map<string,string>`.
> - `lib/repos/merchantMap.ts`: `upsertUserRule(db, {pattern, matchType, categoryId}) => string`.
> - `lib/repos/accounts.ts`: `listAccounts(db) => {id,name,currency}[]`.
> - `lib/import/ai-apply.ts`: `AI_CONFIDENCE_THRESHOLD` (0.6).
> - `lib/format.ts`: `formatMoneyMinor(amountMinor, currency, locale?)`. `cn()` in `@/lib/utils`. `createAdminClient()` (server-only).
> - `ColumnMapping` (`@/lib/domain/types`): `{ dateColumn, dateFormat: DateFormat, descriptionColumns: string[], amount: {mode:"signed",amountColumn} | {mode:"debit_credit",debitColumn,creditColumn}, decimalSep: ","|".", currencyColumn?, defaultCurrency }`. `DateFormat = "DD.MM.YYYY"|"DD-MM-YYYY"|"YYYY-MM-DD"|"DD/MM/YYYY"|"MM/DD/YYYY"`.
> - `/api/import` (POST multipart `file`, `accountId`, optional `mapping` JSON) responds: `{status:"needs_mapping", header:string[], rowCount, encoding, delimiter}` | `{status:"imported", batchId, rowCount, inserted, duplicates, aiCategorized, errors}` | `{error}` (with 4xx/5xx).

---

## Target File Structure (end of this phase)

```
lib/repos/transactions.ts                       # MODIFY: listTransactions += needsReview filter + categorySource/aiConfidence
lib/repos/__tests__/transactions.itest.ts       # MODIFY: cover needsReview + new fields
lib/transactions/correct.ts                      # applyCorrection(db, {...}) (+ itest)
lib/transactions/__tests__/correct.itest.ts
app/(app)/transactions/actions.ts                # "use server" correctCategory()
app/(app)/transactions/page.tsx                  # REPLACE placeholder: server page (filters + table)
components/transactions/transactions-filters.tsx # client: search/category/needs-review → URL params
components/transactions/transactions-table.tsx   # client: rows + inline category <select> + badge
components/import/column-mapping-form.tsx         # client: build a ColumnMapping from detected headers
components/import/import-wizard.tsx               # client: 3-step wizard over /api/import
app/(app)/import/page.tsx                         # REPLACE placeholder: server page (accounts → wizard)
components/ui/select.tsx                          # minimal native <select> wrapper (dep-free)
```

**Conventions:** `npm test` = unit (jsdom). `npm run test:integration` = `*.itest.ts` (local Supabase + `.env.local`). Each task ends with a commit + the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git -c core.safecrlf=false commit` if CRLF warnings. Never commit `.env.local`.

---

## Task 1: Extend `listTransactions` (needs-review + source/confidence)

**Files:**
- Modify: `lib/repos/transactions.ts`
- Modify: `lib/repos/__tests__/transactions.itest.ts`

- [ ] **Step 1: Update the `TxnFilter` and `TxnListItem` interfaces and the `listTransactions` function**

In `lib/repos/transactions.ts`, add the import near the top (with the other imports):
```ts
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/import/ai-apply";
```

Replace the existing `TxnFilter` interface, `TxnListItem` interface, and `listTransactions` function with:
```ts
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
  /** Only rows that need attention: uncategorized, or AI-categorized below the confidence threshold. */
  needsReview?: boolean;
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
  categorySource: string;
  aiConfidence: number | null;
}

/** Filtered, newest-first, row-capped transaction list (for the table UI and the list_transactions Q&A tool). */
export async function listTransactions(db: Db, filter: TxnFilter = {}): Promise<TxnListItem[]> {
  let categoryId: string | undefined;
  if (filter.category) {
    const nameToId = await getCategoryNameToId(db);
    categoryId = nameToId.get(filter.category);
    if (!categoryId) return []; // unknown category name → no matches
  }

  // Filters first (filter builder), THEN order/limit (transform builder).
  let q = db
    .from("transactions")
    .select(
      "id, booked_at, amount_minor, currency, merchant, raw_description, category_source, ai_confidence, category:categories(name)",
    );
  if (filter.fromISO) q = q.gte("booked_at", filter.fromISO);
  if (filter.toISO) q = q.lte("booked_at", filter.toISO);
  if (categoryId) q = q.eq("category_id", categoryId);
  if (filter.merchant) q = q.ilike("merchant", `%${filter.merchant}%`);
  if (filter.minAmountMinor !== undefined) q = q.gte("amount_minor", filter.minAmountMinor);
  if (filter.maxAmountMinor !== undefined) q = q.lte("amount_minor", filter.maxAmountMinor);
  if (filter.accountId) q = q.eq("account_id", filter.accountId);
  if (filter.needsReview) {
    q = q.or(`category_source.eq.uncategorized,and(category_source.eq.ai,ai_confidence.lt.${AI_CONFIDENCE_THRESHOLD})`);
  }

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
        category_source: string;
        ai_confidence: number | null;
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
    categorySource: r.category_source,
    aiConfidence: r.ai_confidence,
  }));
}
```

(Keep `getTransactionsInRange` and `updateTransactionCategory` unchanged. `LIST_LIMIT_DEFAULT`/`LIST_LIMIT_MAX` already exist.)

- [ ] **Step 2: Add an integration test case**

Append to `lib/repos/__tests__/transactions.itest.ts` a new block (reusing the module-level `db`, `draft`, `insertDrafts`):
```ts
import { getCategoryNameToId as getNameToId2 } from "@/lib/repos/categories";

describe.sequential("listTransactions needsReview filter (integration)", () => {
  let acctId: string;

  beforeAll(async () => {
    const { data, error } = await db.from("accounts").insert({ name: "ITEST review acct", currency: "PLN" }).select("id").single();
    if (error) throw new Error(error.message);
    acctId = data.id;
    const groceriesId = (await getNameToId2(db)).get("Groceries")!;
    await insertDrafts(db, acctId, null, [
      draft({ dedupHash: "nr1", merchant: "RULED", categoryId: groceriesId, categorySource: "rule" }),
      draft({ dedupHash: "nr2", merchant: "LOWAI", categoryId: groceriesId, categorySource: "ai", aiConfidence: 0.3 }),
      draft({ dedupHash: "nr3", merchant: "HIAI", categoryId: groceriesId, categorySource: "ai", aiConfidence: 0.95 }),
      draft({ dedupHash: "nr4", merchant: "NONE", categoryId: null, categorySource: "uncategorized" }),
    ]);
  });

  afterAll(async () => {
    await db.from("accounts").delete().eq("id", acctId);
  });

  it("returns only uncategorized and low-confidence AI rows", async () => {
    const rows = await listTransactions(db, { accountId: acctId, needsReview: true });
    const merchants = rows.map((r) => r.merchant).sort();
    expect(merchants).toEqual(["LOWAI", "NONE"]);
  });

  it("exposes categorySource and aiConfidence on rows", async () => {
    const all = await listTransactions(db, { accountId: acctId });
    const hi = all.find((r) => r.merchant === "HIAI");
    expect(hi?.categorySource).toBe("ai");
    expect(hi?.aiConfidence).toBeCloseTo(0.95, 2);
  });
});
```
(Add `listTransactions` to the existing import from `@/lib/repos/transactions` at the top of the file if not already imported.)

- [ ] **Step 3: Run** — `npm run test:integration` → passes (new cases + all prior).

- [ ] **Step 4: Commit**

```bash
git add lib/repos/transactions.ts lib/repos/__tests__/transactions.itest.ts
git commit -m "feat(repos): listTransactions needs-review filter + source/confidence fields"
```

---

## Task 2: `applyCorrection` (update category + learn rule)

**Files:**
- Create: `lib/transactions/correct.ts`
- Test: `lib/transactions/__tests__/correct.itest.ts`

- [ ] **Step 1: Create `lib/transactions/correct.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";
import { getCategoryNameToId } from "@/lib/repos/categories";
import { updateTransactionCategory } from "@/lib/repos/transactions";
import { upsertUserRule } from "@/lib/repos/merchantMap";

/**
 * Apply a manual category correction: set the transaction to the chosen category
 * with source "user" (protected from future overwrite), and — when the row has a
 * merchant — learn a `contains` merchant_map rule so future imports of the same
 * merchant categorize automatically. Throws on an unknown category name.
 */
export async function applyCorrection(
  db: Db,
  input: { transactionId: string; merchant: string | null; categoryName: string },
): Promise<void> {
  const nameToId = await getCategoryNameToId(db);
  const categoryId = nameToId.get(input.categoryName);
  if (!categoryId) throw new Error(`Unknown category: ${input.categoryName}`);

  await updateTransactionCategory(db, input.transactionId, categoryId, "user");

  const pattern = (input.merchant ?? "").trim();
  if (pattern) {
    await upsertUserRule(db, { pattern, matchType: "contains", categoryId });
  }
}
```

- [ ] **Step 2: Create `lib/transactions/__tests__/correct.itest.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCorrection } from "@/lib/transactions/correct";
import { insertDrafts, listTransactions } from "@/lib/repos/transactions";

const db = createAdminClient();
let acctId: string;
const MERCHANT = "ITEST_CORRECT_MERCHANT";

beforeAll(async () => {
  const { data, error } = await db.from("accounts").insert({ name: "ITEST correct acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  await insertDrafts(db, acctId, null, [
    {
      bookedAt: "2026-05-09",
      amountMinor: -4200,
      currency: "PLN",
      rawDescription: `${MERCHANT} 1`,
      merchant: MERCHANT,
      dedupHash: "corr1",
      categoryId: null,
      categorySource: "uncategorized",
    },
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
  await db.from("merchant_map").delete().eq("pattern", MERCHANT);
});

describe.sequential("applyCorrection (integration)", () => {
  it("sets the transaction to user-sourced and learns a contains rule", async () => {
    const before = await listTransactions(db, { accountId: acctId });
    const txnId = before[0].id;

    await applyCorrection(db, { transactionId: txnId, merchant: MERCHANT, categoryName: "Transport" });

    const after = await listTransactions(db, { accountId: acctId });
    expect(after[0].category).toBe("Transport");
    expect(after[0].categorySource).toBe("user");

    const { data: rules } = await db.from("merchant_map").select("match_type, source, category_id").eq("pattern", MERCHANT);
    expect(rules).toHaveLength(1);
    expect(rules?.[0].match_type).toBe("contains");
    expect(rules?.[0].source).toBe("user");
  });

  it("throws on an unknown category", async () => {
    const rows = await listTransactions(db, { accountId: acctId });
    await expect(applyCorrection(db, { transactionId: rows[0].id, merchant: null, categoryName: "Nope" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → passes.

- [ ] **Step 4: Commit**

```bash
git add lib/transactions/correct.ts lib/transactions/__tests__/correct.itest.ts
git commit -m "feat(transactions): applyCorrection (user category + learned rule)"
```

---

## Task 3: Correction server action

**Files:**
- Create: `app/(app)/transactions/actions.ts`

- [ ] **Step 1: Create `app/(app)/transactions/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCorrection } from "@/lib/transactions/correct";

export interface CorrectResult {
  ok: boolean;
  error?: string;
}

/** Server Action: apply a category correction from the transactions table, then revalidate the affected pages. */
export async function correctCategory(input: {
  transactionId: string;
  merchant: string | null;
  categoryName: string;
}): Promise<CorrectResult> {
  try {
    await applyCorrection(createAdminClient(), input);
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Correction failed" };
  }
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/transactions/actions.ts"
git commit -m "feat(transactions): correctCategory server action"
```

---

## Task 4: Minimal `Select` UI primitive

**Files:**
- Create: `components/ui/select.tsx`

- [ ] **Step 1: Create `components/ui/select.tsx`** (dependency-free native select)

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-9 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/ui/select.tsx
git commit -m "feat(ui): minimal native select primitive"
```

---

## Task 5: Transactions filters (client, URL-driven)

**Files:**
- Create: `components/transactions/transactions-filters.tsx`

- [ ] **Step 1: Create `components/transactions/transactions-filters.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/ui/select";

/** Search + category + needs-review filters that drive the page via URL search params. */
export function TransactionsFilters({ categories }: { categories: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("merchant") ?? "");

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/transactions?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParam("merchant", search.trim());
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search merchant…"
          className="h-9 w-56 rounded-md border bg-background px-3 text-sm"
        />
      </form>

      <Select value={params.get("category") ?? ""} onChange={(e) => setParam("category", e.target.value)}>
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={params.get("needsReview") === "1"}
          onChange={(e) => setParam("needsReview", e.target.checked ? "1" : "")}
        />
        Needs review
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/transactions/transactions-filters.tsx
git commit -m "feat(transactions): URL-driven filters (search, category, needs-review)"
```

---

## Task 6: Transactions table (client, inline edit)

**Files:**
- Create: `components/transactions/transactions-table.tsx`

- [ ] **Step 1: Create `components/transactions/transactions-table.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { TxnListItem } from "@/lib/repos/transactions";
import { correctCategory } from "@/app/(app)/transactions/actions";
import { formatMoneyMinor } from "@/lib/format";
import { Select } from "@/components/ui/select";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/import/ai-apply";

function needsReview(t: TxnListItem): boolean {
  return t.categorySource === "uncategorized" || (t.categorySource === "ai" && (t.aiConfidence ?? 0) < AI_CONFIDENCE_THRESHOLD);
}

function CategoryCell({ row, categories }: { row: TxnListItem; categories: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Select
        defaultValue={row.category ?? ""}
        disabled={pending}
        onChange={(e) => {
          const categoryName = e.target.value;
          if (!categoryName) return;
          setError(null);
          start(async () => {
            const res = await correctCategory({ transactionId: row.id, merchant: row.merchant, categoryName });
            if (!res.ok) setError(res.error ?? "Failed");
          });
        }}
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

export function TransactionsTable({ rows, categories }: { rows: TxnListItem[]; categories: string[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No transactions match these filters.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Merchant</th>
            <th className="py-2 pr-4 font-medium">Category</th>
            <th className="py-2 pr-4 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2 pr-4 whitespace-nowrap">{t.bookedAt}</td>
              <td className="py-2 pr-4">
                <div className="font-medium">{t.merchant ?? t.rawDescription}</div>
                {needsReview(t) ? <span className="text-xs text-amber-600">Needs review</span> : null}
              </td>
              <td className="py-2 pr-4">
                <CategoryCell row={t} categories={categories} />
              </td>
              <td className={cnAmount(t.amountMinor)}>{formatMoneyMinor(t.amountMinor, t.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cnAmount(amountMinor: number): string {
  return amountMinor < 0 ? "py-2 pr-4 text-right whitespace-nowrap" : "py-2 pr-4 text-right whitespace-nowrap text-emerald-600";
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/transactions/transactions-table.tsx
git commit -m "feat(transactions): table with inline category editing + needs-review badge"
```

---

## Task 7: Transactions page (server)

**Files:**
- Modify (replace placeholder): `app/(app)/transactions/page.tsx`

- [ ] **Step 1: Replace `app/(app)/transactions/page.tsx`**

```tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { listTransactions } from "@/lib/repos/transactions";
import { listCategories } from "@/lib/repos/categories";
import { TransactionsFilters } from "@/components/transactions/transactions-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string; category?: string; needsReview?: string }>;
}) {
  const sp = await searchParams;
  const db = createAdminClient();
  const [rows, categories] = await Promise.all([
    listTransactions(db, {
      merchant: sp.merchant,
      category: sp.category,
      needsReview: sp.needsReview === "1",
      limit: 200,
    }),
    listCategories(db),
  ]);
  const categoryNames = categories.map((c) => c.name);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <TransactionsFilters categories={categoryNames} />
      <TransactionsTable rows={rows} categories={categoryNames} />
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0; `npm run build` → compiles (`/transactions` dynamic).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/transactions/page.tsx"
git commit -m "feat(transactions): wire transactions page (filters + table)"
```

---

## Task 8: Column-mapping form (client)

**Files:**
- Create: `components/import/column-mapping-form.tsx`

- [ ] **Step 1: Create `components/import/column-mapping-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { ColumnMapping, DateFormat } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";

const DATE_FORMATS: DateFormat[] = ["DD.MM.YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];

/** Let the user map a bank's CSV columns onto our fields, then hand back a ColumnMapping. */
export function ColumnMappingForm({
  header,
  defaultCurrency,
  onSubmit,
}: {
  header: string[];
  defaultCurrency: string;
  onSubmit: (mapping: ColumnMapping) => void;
}) {
  const [dateColumn, setDateColumn] = useState(header[0] ?? "");
  const [dateFormat, setDateFormat] = useState<DateFormat>("YYYY-MM-DD");
  const [mode, setMode] = useState<"signed" | "debit_credit">("signed");
  const [amountColumn, setAmountColumn] = useState(header[0] ?? "");
  const [debitColumn, setDebitColumn] = useState(header[0] ?? "");
  const [creditColumn, setCreditColumn] = useState(header[0] ?? "");
  const [descriptionColumns, setDescriptionColumns] = useState<string[]>([]);
  const [decimalSep, setDecimalSep] = useState<"," | ".">(",");
  const [currency, setCurrency] = useState(defaultCurrency);

  function toggleDesc(col: string) {
    setDescriptionColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  }

  const valid =
    dateColumn && descriptionColumns.length > 0 && (mode === "signed" ? !!amountColumn : !!debitColumn && !!creditColumn);

  function submit() {
    const amount: ColumnMapping["amount"] =
      mode === "signed" ? { mode: "signed", amountColumn } : { mode: "debit_credit", debitColumn, creditColumn };
    onSubmit({ dateColumn, dateFormat, descriptionColumns, amount, decimalSep, defaultCurrency: currency });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Date column
        <Select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
          {header.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Date format
        <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">Amount</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === "signed"} onChange={() => setMode("signed")} /> One signed column
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === "debit_credit"} onChange={() => setMode("debit_credit")} /> Separate debit / credit
        </label>
        {mode === "signed" ? (
          <Select value={amountColumn} onChange={(e) => setAmountColumn(e.target.value)}>
            {header.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </Select>
        ) : (
          <div className="flex gap-2">
            <Select value={debitColumn} onChange={(e) => setDebitColumn(e.target.value)}>
              {header.map((h) => (
                <option key={h} value={h}>Debit: {h}</option>
              ))}
            </Select>
            <Select value={creditColumn} onChange={(e) => setCreditColumn(e.target.value)}>
              {header.map((h) => (
                <option key={h} value={h}>Credit: {h}</option>
              ))}
            </Select>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">Description column(s)</legend>
        <div className="flex flex-wrap gap-3">
          {header.map((h) => (
            <label key={h} className="flex items-center gap-2">
              <input type="checkbox" checked={descriptionColumns.includes(h)} onChange={() => toggleDesc(h)} />
              {h}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Decimal separator
          <Select value={decimalSep} onChange={(e) => setDecimalSep(e.target.value as "," | ".")}>
            <option value=",">comma (1 234,56)</option>
            <option value=".">dot (1,234.56)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Default currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 w-24 rounded-md border bg-background px-2 text-sm" />
        </label>
      </div>

      <button
        type="button"
        disabled={!valid}
        onClick={submit}
        className="self-start rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/import/column-mapping-form.tsx
git commit -m "feat(import): column-mapping form"
```

---

## Task 9: Import wizard (client)

**Files:**
- Create: `components/import/import-wizard.tsx`

- [ ] **Step 1: Create `components/import/import-wizard.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { ColumnMapping } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";
import { ColumnMappingForm } from "@/components/import/column-mapping-form";

interface ImportSummary {
  inserted: number;
  duplicates: number;
  aiCategorized: number;
  rowCount: number;
}

type Step = "upload" | "map" | "done";

async function postImport(file: File, accountId: string, mapping?: ColumnMapping) {
  const form = new FormData();
  form.set("file", file);
  form.set("accountId", accountId);
  if (mapping) form.set("mapping", JSON.stringify(mapping));
  const res = await fetch("/api/import", { method: "POST", body: form });
  return (await res.json()) as
    | { status: "needs_mapping"; header: string[]; rowCount: number }
    | ({ status: "imported" } & ImportSummary)
    | { error: string };
}

export function ImportWizard({ accounts, defaultCurrency }: { accounts: { id: string; name: string }[]; defaultCurrency: string }) {
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mapping?: ColumnMapping) {
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    const result = await postImport(file, accountId, mapping);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (result.status === "needs_mapping") {
      setHeader(result.header);
      setStep("map");
      return;
    }
    setSummary(result);
    setStep("done");
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setHeader([]);
    setSummary(null);
    setError(null);
  }

  if (accounts.length === 0) {
    return <p className="text-muted-foreground text-sm">Create an account in Settings before importing.</p>;
  }

  return (
    <div className="max-w-2xl">
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {step === "upload" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Account
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            CSV file
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button
            type="button"
            disabled={!file || !accountId || busy}
            onClick={() => send()}
            className="self-start rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Continue"}
          </button>
        </div>
      )}

      {step === "map" && (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">New bank layout — map its columns once and we'll remember it.</p>
          <ColumnMappingForm header={header} defaultCurrency={defaultCurrency} onSubmit={(mapping) => void send(mapping)} />
        </div>
      )}

      {step === "done" && summary && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Import complete</h2>
          <ul className="text-sm">
            <li>Imported: {summary.inserted}</li>
            <li>Duplicates skipped: {summary.duplicates}</li>
            <li>AI-categorized: {summary.aiCategorized}</li>
            <li>Rows in file: {summary.rowCount}</li>
          </ul>
          <button type="button" onClick={reset} className="self-start rounded-md border px-4 py-2 text-sm">
            Import another
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/import/import-wizard.tsx
git commit -m "feat(import): 3-step import wizard over /api/import"
```

---

## Task 10: Import page (server) + verification

**Files:**
- Modify (replace placeholder): `app/(app)/import/page.tsx`

- [ ] **Step 1: Replace `app/(app)/import/page.tsx`**

```tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { listAccounts } from "@/lib/repos/accounts";
import { ImportWizard } from "@/components/import/import-wizard";

export const dynamic = "force-dynamic";

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";

export default async function ImportPage() {
  const db = createAdminClient();
  const accounts = await listAccounts(db);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Import</h1>
      <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} defaultCurrency={DEFAULT_CURRENCY} />
    </div>
  );
}
```

- [ ] **Step 2: Unit suite** — `npm test`
Expected: all pass; NO `*.itest.ts`/`*.smoke.ts` collected. (No new unit tests this phase — the new logic is integration-tested; UI is build-verified.)

- [ ] **Step 3: Integration tier** — `npm run test:integration`
Expected: 0 failures, incl. the new `listTransactions` needs-review cases and `applyCorrection` itest.

- [ ] **Step 4: typecheck / lint / build**

```bash
npm run typecheck   # exit 0
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"; /transactions and /import build (dynamic)
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/import/page.tsx"
git commit -m "feat(import): wire import page (accounts -> wizard)"
git add -A -- ':!.env.local'
git commit -m "chore: phase 6b verification" || echo "nothing to commit"
```

---

## Done when

- `npm test` passes; `npm run test:integration` passes (incl. `listTransactions` needs-review + `applyCorrection`).
- `npm run typecheck`, `npm run lint`, `npm run build` all pass; `/transactions` and `/import` build (dynamic).
- Behaviour: Transactions screen lists rows with search/category/needs-review filters (URL-driven); changing a row's category select persists it as `user`-sourced, learns a `merchant_map` rule, and the row's "Needs review" badge clears on refresh. The Import wizard uploads a CSV, prompts for column mapping on an unknown bank layout (and remembers it), and shows an import summary; a known layout imports straight through.

**Manual smoke (optional, not automated — Playwright deferred):** with local Supabase running and an account present, import a sample CSV through the wizard, then correct a category on the Transactions screen and confirm a `merchant_map` rule appears.

**Next:** Phase 6C — Insights feed (`/api/insights`, on-demand cached monthly narrative + supporting numbers), the Ask slide-over panel (`/api/ask`, opened from a button / `/` shortcut), and Settings (accounts CRUD, categories, import profiles, model/budget config). Plus the deferred 6A polish (donut legend) and the 5B-2 minors (e.g. save import profile only after a successful import).
