# AI Budget Assistant — Phase 6A: App Shell + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the authenticated app shell (sidebar nav layout) and a working Dashboard — KPI cards, a spend-by-category donut, a 6-month trend chart, and recent transactions — reading real data through the existing repos behind the Phase 5A login.

**Architecture:** A Next route group `app/(app)/` holds every authenticated screen and supplies the sidebar layout; the Dashboard lives at `/`. Reads happen in **server components** via a single `getDashboardData(db, ...)` assembler over the existing repos + pure aggregators (integration-tested). Charts are small **client** components (Recharts) that receive already-computed data as props. Currency/number formatting is a pure, unit-tested helper. UI primitives are hand-rolled minimal components (a `Card`) plus plain Tailwind — no shadcn CLI run and no new Radix deps; the only new dependency is Recharts.

**Tech Stack:** Next.js 15 App Router (route groups, server components), React 19, Tailwind v4, Recharts (new), lucide-react (already present), Vitest + @testing-library/react (already present). Money is signed integer minor units; division to major units happens only at display time.

> **Phase context:** Phase 6A of the 7-phase build. Phase 6 (UI) was split 3 ways: **6A (this: app shell + dashboard)**, **6B (transactions table + import wizard)**, **6C (insights feed + Ask slide-over + settings)**. `main` has Phases 1–5 complete: the full backend (auth lock + session-aware clients, all repos, pure query/stat layer, DB-backed QueryTools, import orchestrator, insights service, and `/api/ask` `/api/insights` `/api/import`). Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` §9 (dashboard-first layout with sidebar; Ask panel is a slide-over — built in 6C). Local Supabase must be running with `.env.local` for the integration test. The shell includes nav links to Transactions/Insights/Import/Settings; those routes get **placeholder pages** in 6A and are replaced in 6B/6C.

> **Signatures already on `main` (do not re-derive):**
> - Repos (`lib/repos/*`, take `db: Db` from `@/lib/supabase/admin`): `getTransactionsInRange(db,{fromISO,toISO,accountId?}) => TxnRow[]`, `listTransactions(db, filter) => TxnListItem[]` (`TxnListItem = {id, bookedAt, amountMinor, currency, merchant, rawDescription, category}`), `listAccounts(db)`.
> - Pure (`lib/queries/*`): `parsePeriod(period) => {fromISO,toISO,label}`, `previousMonth(month)`, `totals(rows) => {totalSpentMinor,totalIncomeMinor,netMinor}`, `spendByCategory(rows) => {category,spentMinor}[]` (most-negative first), `deltaPct(from,to) => number|null`. `TxnRow = {amountMinor, merchant, currency, categoryName}`.
> - Auth/clients: `createAdminClient()` (server-only, service role), `createSupabaseServerClient()` (cookie session), `signOut` server action in `@/app/login/actions`. `cn()` in `@/lib/utils`. Middleware already gates everything except `/login`.

---

## Target File Structure (end of this phase)

```
package.json                              # + recharts
lib/format.ts                             # formatMoneyMinor, lastNMonths, shortMonthLabel (+ unit test)
lib/dashboard/data.ts                     # getDashboardData(db, {month, accountId?, currency?}) (+ itest)
components/ui/card.tsx                     # minimal Card / CardHeader / CardTitle / CardContent
components/app-sidebar.tsx                # client sidebar nav + sign-out
components/dashboard/kpi-cards.tsx        # KPI cards (presentational) (+ render test)
components/dashboard/recent-transactions.tsx
components/charts/category-donut.tsx      # client (Recharts PieChart)
components/charts/trend-chart.tsx         # client (Recharts BarChart)
app/(app)/layout.tsx                      # sidebar shell (server component)
app/(app)/page.tsx                        # Dashboard (server component)
app/(app)/transactions/page.tsx           # placeholder (replaced in 6B)
app/(app)/import/page.tsx                  # placeholder (replaced in 6B)
app/(app)/insights/page.tsx               # placeholder (replaced in 6C)
app/(app)/settings/page.tsx               # placeholder (replaced in 6C)
app/page.tsx                              # DELETED (Dashboard now lives in the (app) group)
```

**Conventions:** `npm test` = unit (jsdom; no creds/Docker). `npm run test:integration` = `*.itest.ts` (local Supabase + `.env.local`). Each task ends with a commit; append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Use `git -c core.safecrlf=false commit` if CRLF warnings appear. Never commit `.env.local`.

---

## Task 1: Add Recharts

**Files:** Modify `package.json`, `package-lock.json`

- [ ] **Step 1: Install** — Run: `npm install recharts`
Expected: `recharts` added under `dependencies`, no `npm error`.

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add recharts for dashboard charts"
```

---

## Task 2: Formatting + month helpers (pure, TDD)

**Files:**
- Test: `lib/__tests__/format.test.ts`
- Create: `lib/format.ts`

- [ ] **Step 1: Write the failing test**

`lib/__tests__/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatMoneyMinor, lastNMonths, shortMonthLabel } from "@/lib/format";

describe("formatMoneyMinor", () => {
  it("formats signed minor units as currency (deterministic en-US/USD)", () => {
    expect(formatMoneyMinor(-482000, "USD", "en-US")).toBe("-$4,820.00");
    expect(formatMoneyMinor(0, "USD", "en-US")).toBe("$0.00");
    expect(formatMoneyMinor(12345, "USD", "en-US")).toBe("$123.45");
  });

  it("includes the PLN currency for the default locale", () => {
    expect(formatMoneyMinor(-482000, "PLN")).toContain("zł");
  });
});

describe("lastNMonths", () => {
  it("returns N consecutive months ending at the given month, oldest first", () => {
    expect(lastNMonths("2026-06", 6)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  });
  it("crosses the year boundary", () => {
    expect(lastNMonths("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("throws on a non-month", () => {
    expect(() => lastNMonths("2026-13", 3)).toThrow();
  });
});

describe("shortMonthLabel", () => {
  it("maps a month to its short name", () => {
    expect(shortMonthLabel("2026-05")).toBe("May");
    expect(shortMonthLabel("2026-12")).toBe("Dec");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/__tests__/format.test.ts` → FAIL (cannot resolve `@/lib/format`).

- [ ] **Step 3: Create `lib/format.ts`**

```ts
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format signed integer minor units as a localized currency string (e.g. -482000 → "-$4,820.00"). */
export function formatMoneyMinor(amountMinor: number, currency: string, locale = "pl-PL"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);
}

/** The N consecutive months ending at `endMonth` ("YYYY-MM"), oldest → newest. Throws on a bad month. */
export function lastNMonths(endMonth: string, n: number): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(endMonth.trim());
  if (!m) throw new Error(`Not a month: ${endMonth}`);
  let year = Number(m[1]);
  let mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error(`Invalid month: ${endMonth}`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${year}-${String(mon).padStart(2, "0")}`);
    mon -= 1;
    if (mon === 0) {
      mon = 12;
      year -= 1;
    }
  }
  return out;
}

/** Short month name for a "YYYY-MM" (e.g. "May"). Throws on a bad month. */
export function shortMonthLabel(month: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(month.trim());
  if (!m) throw new Error(`Not a month: ${month}`);
  const idx = Number(m[1]) - 1;
  if (idx < 0 || idx > 11) throw new Error(`Invalid month: ${month}`);
  return SHORT_MONTHS[idx];
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run lib/__tests__/format.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts lib/__tests__/format.test.ts
git commit -m "feat(ui): currency + month formatting helpers"
```

---

## Task 3: Dashboard data assembler (integration)

**Files:**
- Create: `lib/dashboard/data.ts`
- Test: `lib/dashboard/__tests__/data.itest.ts`

- [ ] **Step 1: Create `lib/dashboard/data.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";
import { parsePeriod, previousMonth } from "@/lib/queries/period";
import { getTransactionsInRange, listTransactions, type TxnListItem } from "@/lib/repos/transactions";
import { totals, spendByCategory } from "@/lib/queries/aggregate";
import { lastNMonths } from "@/lib/format";

export interface DashboardData {
  month: string;
  currency: string;
  spentThisMonthMinor: number;
  spentLastMonthMinor: number;
  topCategory: { category: string; spentMinor: number } | null;
  byCategory: { category: string; spentMinor: number }[];
  trend: { month: string; spentMinor: number }[];
  recent: TxnListItem[];
}

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";
const TREND_MONTHS = 6;
const RECENT_LIMIT = 8;

/**
 * Assemble everything the dashboard shows for a given "YYYY-MM" month, from the
 * repos + pure aggregators: this/last month spend, top category, the category
 * breakdown (donut), a 6-month spend trend, and the most recent transactions.
 */
export async function getDashboardData(
  db: Db,
  opts: { month: string; accountId?: string; currency?: string },
): Promise<DashboardData> {
  const cur = parsePeriod(opts.month);
  const prev = parsePeriod(previousMonth(opts.month));

  const [curRows, prevRows] = await Promise.all([
    getTransactionsInRange(db, { fromISO: cur.fromISO, toISO: cur.toISO, accountId: opts.accountId }),
    getTransactionsInRange(db, { fromISO: prev.fromISO, toISO: prev.toISO, accountId: opts.accountId }),
  ]);

  const byCategory = spendByCategory(curRows);

  const trend = await Promise.all(
    lastNMonths(opts.month, TREND_MONTHS).map(async (mn) => {
      const b = parsePeriod(mn);
      const rows = await getTransactionsInRange(db, { fromISO: b.fromISO, toISO: b.toISO, accountId: opts.accountId });
      return { month: mn, spentMinor: totals(rows).totalSpentMinor };
    }),
  );

  const recent = await listTransactions(db, { accountId: opts.accountId, limit: RECENT_LIMIT });

  return {
    month: opts.month,
    currency: opts.currency ?? DEFAULT_CURRENCY,
    spentThisMonthMinor: totals(curRows).totalSpentMinor,
    spentLastMonthMinor: totals(prevRows).totalSpentMinor,
    topCategory: byCategory[0] ?? null,
    byCategory,
    trend,
    recent,
  };
}
```

- [ ] **Step 2: Create `lib/dashboard/__tests__/data.itest.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/dashboard/data";
import { insertDrafts } from "@/lib/repos/transactions";
import { getCategoryNameToId } from "@/lib/repos/categories";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
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
  const { data, error } = await db.from("accounts").insert({ name: "ITEST dash acct", currency: "PLN" }).select("id").single();
  if (error) throw new Error(error.message);
  acctId = data.id;
  const groceriesId = (await getCategoryNameToId(db)).get("Groceries")!;
  await insertDrafts(db, acctId, null, [
    draft({ dedupHash: "da1", bookedAt: "2026-05-04", amountMinor: -13000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
    draft({ dedupHash: "da2", bookedAt: "2026-05-20", amountMinor: -5000, merchant: "MPK", categoryId: null, categorySource: "uncategorized" }),
    draft({ dedupHash: "da3", bookedAt: "2026-04-15", amountMinor: -9000, merchant: "BIEDRONKA", categoryId: groceriesId, categorySource: "rule" }),
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
});

describe.sequential("getDashboardData (integration)", () => {
  it("assembles month spend, top category, a 6-point trend, and recent transactions", async () => {
    const d = await getDashboardData(db, { month: "2026-05", accountId: acctId });
    expect(d.spentThisMonthMinor).toBe(-18000);
    expect(d.spentLastMonthMinor).toBe(-9000);
    expect(d.topCategory).toEqual({ category: "Groceries", spentMinor: -13000 });
    expect(d.byCategory).toEqual([
      { category: "Groceries", spentMinor: -13000 },
      { category: "Uncategorized", spentMinor: -5000 },
    ]);
    expect(d.trend).toHaveLength(6);
    expect(d.trend[d.trend.length - 1]).toEqual({ month: "2026-05", spentMinor: -18000 });
    expect(d.recent.length).toBe(3);
    expect(d.recent[0].bookedAt).toBe("2026-05-20"); // newest first
  });
});
```

- [ ] **Step 3: Run** — `npm run test:integration` → dashboard data itest passes.

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard/data.ts lib/dashboard/__tests__/data.itest.ts
git commit -m "feat(dashboard): server-side dashboard data assembler"
```

---

## Task 4: App shell (route group, sidebar, placeholders)

**Files:**
- Create: `components/ui/card.tsx`, `components/app-sidebar.tsx`, `app/(app)/layout.tsx`, `app/(app)/page.tsx` (placeholder), `app/(app)/transactions/page.tsx`, `app/(app)/import/page.tsx`, `app/(app)/insights/page.tsx`, `app/(app)/settings/page.tsx`
- Delete: `app/page.tsx`

- [ ] **Step 1: Create `components/ui/card.tsx`** (minimal, dependency-free)

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm font-medium text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
```

- [ ] **Step 2: Create `components/app-sidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, Sparkles, Upload, Settings } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ListChecks },
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/30 p-4">
      <div className="px-2 pb-4 text-lg font-semibold">Budget</div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t pt-3">
        <p className="truncate px-3 pb-2 text-xs text-muted-foreground">{email}</p>
        <form action={signOut}>
          <button type="submit" className="w-full rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create `app/(app)/layout.tsx`**

```tsx
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen">
      <AppSidebar email={user?.email ?? ""} />
      <main className="flex-1 overflow-x-hidden p-6 md:p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Create the placeholder dashboard + screen pages**

`app/(app)/page.tsx` (temporary — replaced in Task 7):
```tsx
export default function DashboardPage() {
  return <h1 className="text-2xl font-semibold">Dashboard</h1>;
}
```

`app/(app)/transactions/page.tsx`:
```tsx
export default function TransactionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <p className="text-muted-foreground mt-2 text-sm">Coming soon.</p>
    </div>
  );
}
```

`app/(app)/import/page.tsx`:
```tsx
export default function ImportPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Import</h1>
      <p className="text-muted-foreground mt-2 text-sm">Coming soon.</p>
    </div>
  );
}
```

`app/(app)/insights/page.tsx`:
```tsx
export default function InsightsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Insights</h1>
      <p className="text-muted-foreground mt-2 text-sm">Coming soon.</p>
    </div>
  );
}
```

`app/(app)/settings/page.tsx`:
```tsx
export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-muted-foreground mt-2 text-sm">Coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 5: Delete the old landing page**

Run: `git rm app/page.tsx`
(The Dashboard now lives at `app/(app)/page.tsx`; leaving the old file would create a duplicate `/` route and fail the build.)

- [ ] **Step 6: Verify** — `npm run typecheck` → exit 0; `npm run build` → "Compiled successfully" (sidebar shell renders; `/`, `/transactions`, `/import`, `/insights`, `/settings` all build).

- [ ] **Step 7: Commit**

```bash
# Step 5 already staged the deletion of app/page.tsx; -A stages the new files + that deletion.
git add -A -- app components
git commit -m "feat(ui): authenticated app shell with sidebar nav"
```

---

## Task 5: Chart components (client, Recharts)

**Files:**
- Create: `components/charts/category-donut.tsx`, `components/charts/trend-chart.tsx`

- [ ] **Step 1: Create `components/charts/category-donut.tsx`**

```tsx
"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoneyMinor } from "@/lib/format";

const COLORS = ["#0a84ff", "#34c759", "#ff9f0a", "#5e5ce6", "#ff375f", "#64d2ff", "#bf5af2", "#98989d"];

export function CategoryDonut({
  data,
  currency,
}: {
  data: { category: string; spentMinor: number }[];
  currency: string;
}) {
  // Recharts needs positive magnitudes; spend is stored negative.
  const slices = data.slice(0, COLORS.length).map((d) => ({ name: d.category, value: Math.abs(d.spentMinor) }));

  if (slices.length === 0) {
    return <p className="text-muted-foreground flex h-64 items-center justify-center text-sm">No spending this month.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
            {slices.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number) => formatMoneyMinor(-value, currency)} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/charts/trend-chart.tsx`**

```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoneyMinor, shortMonthLabel } from "@/lib/format";

export function TrendChart({
  data,
  currency,
}: {
  data: { month: string; spentMinor: number }[];
  currency: string;
}) {
  const points = data.map((d) => ({ label: shortMonthLabel(d.month), spent: Math.abs(d.spentMinor) }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis hide />
          <Tooltip formatter={(value: number) => formatMoneyMinor(-value, currency)} />
          <Bar dataKey="spent" fill="#0a84ff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Verify** — `npm run typecheck` → exit 0; `npm run build` → compiles.

- [ ] **Step 4: Commit**

```bash
git add components/charts
git commit -m "feat(dashboard): category donut + spend trend charts"
```

> The `points` line in `trend-chart.tsx` must read exactly: `const points = data.map((d) => ({ label: shortMonthLabel(d.month), spent: Math.abs(d.spentMinor) }));`

---

## Task 6: KPI cards + recent transactions (presentational)

**Files:**
- Create: `components/dashboard/kpi-cards.tsx`, `components/dashboard/recent-transactions.tsx`
- Test: `components/dashboard/__tests__/kpi-cards.test.tsx`

- [ ] **Step 1: Write the failing test**

`components/dashboard/__tests__/kpi-cards.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCards } from "@/components/dashboard/kpi-cards";

describe("KpiCards", () => {
  it("shows this-month spend, the vs-last-month delta, and the top category", () => {
    render(
      <KpiCards
        spentThisMonthMinor={-130000}
        spentLastMonthMinor={-100000}
        topCategory={{ category: "Groceries", spentMinor: -121000 }}
        currency="USD"
        locale="en-US"
      />,
    );
    expect(screen.getByText("Spent this month")).toBeInTheDocument();
    expect(screen.getByText("$1,300.00")).toBeInTheDocument(); // magnitude shown
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText(/30(\.0)?%/)).toBeInTheDocument(); // 1000 → 1300 = +30%
  });

  it("handles no spending and no top category", () => {
    render(<KpiCards spentThisMonthMinor={0} spentLastMonthMinor={0} topCategory={null} currency="USD" locale="en-US" />);
    // Both the vs-last-month delta (null base) and the top-category card render an em dash.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run components/dashboard/__tests__/kpi-cards.test.tsx` → FAIL (cannot resolve module).

- [ ] **Step 3: Create `components/dashboard/kpi-cards.tsx`**

```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoneyMinor } from "@/lib/format";
import { deltaPct } from "@/lib/queries/aggregate";

export function KpiCards({
  spentThisMonthMinor,
  spentLastMonthMinor,
  topCategory,
  currency,
  locale,
}: {
  spentThisMonthMinor: number;
  spentLastMonthMinor: number;
  topCategory: { category: string; spentMinor: number } | null;
  currency: string;
  locale?: string;
}) {
  const fmt = (m: number) => formatMoneyMinor(m, currency, locale);
  const pct = deltaPct(Math.abs(spentLastMonthMinor), Math.abs(spentThisMonthMinor));

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Spent this month</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{fmt(Math.abs(spentThisMonthMinor))}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>vs last month</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">
          {pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top category</CardTitle>
        </CardHeader>
        <CardContent>
          {topCategory ? (
            <div>
              <div className="text-lg font-semibold">{topCategory.category}</div>
              <div className="text-muted-foreground text-sm">{fmt(Math.abs(topCategory.spentMinor))}</div>
            </div>
          ) : (
            <span className="text-2xl font-semibold">—</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run components/dashboard/__tests__/kpi-cards.test.tsx` → PASS.

- [ ] **Step 5: Create `components/dashboard/recent-transactions.tsx`**

```tsx
import type { TxnListItem } from "@/lib/repos/transactions";
import { formatMoneyMinor } from "@/lib/format";

export function RecentTransactions({ items, currency }: { items: TxnListItem[]; currency: string }) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No transactions yet. Import a CSV from the Import tab to get started.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-4 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">{t.merchant ?? t.rawDescription}</div>
            <div className="text-muted-foreground text-xs">
              {t.bookedAt}
              {t.category ? ` · ${t.category}` : ""}
            </div>
          </div>
          <div className={t.amountMinor < 0 ? "" : "text-emerald-600"}>
            {formatMoneyMinor(t.amountMinor, currency)}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/dashboard
git commit -m "feat(dashboard): KPI cards + recent transactions list"
```

---

## Task 7: Dashboard page

**Files:**
- Modify (replace placeholder): `app/(app)/page.tsx`

- [ ] **Step 1: Replace `app/(app)/page.tsx`**

```tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/dashboard/data";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { CategoryDonut } from "@/components/charts/category-donut";
import { TrendChart } from "@/components/charts/trend-chart";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function DashboardPage() {
  const db = createAdminClient();
  const data = await getDashboardData(db, { month: currentMonth() });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <KpiCards
        spentThisMonthMinor={data.spentThisMonthMinor}
        spentLastMonthMinor={data.spentLastMonthMinor}
        topCategory={data.topCategory}
        currency={data.currency}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryDonut data={data.byCategory} currency={data.currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>6-month trend</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart data={data.trend} currency={data.currency} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentTransactions items={data.recent} currency={data.currency} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0; `npm run build` → compiles (`/` is dynamic).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/page.tsx"
git commit -m "feat(dashboard): wire dashboard page to real data + charts"
```

---

## Task 8: Full verification

- [ ] **Step 1: Unit suite** — `npm test`
Expected: all pass — prior suites + new `format.test.ts` and `kpi-cards.test.tsx`; NO `*.itest.ts`/`*.smoke.ts` collected.

- [ ] **Step 2: Integration tier** — `npm run test:integration`
Expected: 0 failures (prior itests + the new `dashboard/data.itest.ts`). Requires local Supabase + `.env.local`.

- [ ] **Step 3: typecheck / lint / build**

```bash
npm run typecheck   # exit 0
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"; /, /transactions, /import, /insights, /settings build; / is ƒ (Dynamic)
```

- [ ] **Step 4: Manual sanity (optional, not automated)** — with local Supabase running and a user created, `npm run dev`, sign in, and confirm the dashboard renders (KPIs, charts, recent list or the empty state) and the sidebar links navigate.

- [ ] **Step 5: Commit anything outstanding (if not clean)**

```bash
git add -A -- ':!.env.local'
git commit -m "chore: phase 6a verification" || echo "nothing to commit"
```

---

## Done when

- `npm test` passes (incl. `format` + `KpiCards` suites) and collects no `*.itest.ts`/`*.smoke.ts`.
- `npm run test:integration` passes (incl. `getDashboardData`).
- `npm run typecheck`, `npm run lint`, `npm run build` all pass; the sidebar shell + all five routes build and `/` is dynamic.
- Behaviour: signed in, `/` shows the dashboard (KPI cards, category donut, 6-month trend, recent transactions — or graceful empty states); the sidebar navigates to the (placeholder) Transactions/Insights/Import/Settings screens; sign-out works.

**Next:** Phase 6B — Transactions table (filter/search, inline category edit via a server action that calls `updateTransactionCategory` + `upsertUserRule` to learn a merchant_map rule, "needs review" filter for low-confidence rows) and the 3-step Import wizard (upload + pick account → map columns → review & import), driven by the `/api/import` `needs_mapping` flow. Then 6C — Insights feed (`/api/insights`), the Ask slide-over panel (`/api/ask`), and Settings (accounts, categories, import profiles, model/budget config).
