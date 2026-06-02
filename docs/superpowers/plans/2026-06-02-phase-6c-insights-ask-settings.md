# Phase 6C — Insights + Ask Panel + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the app's UI with the Insights feed, the Ask (NL Q&A) slide-over panel, and the Settings page (accounts/categories/import-profiles CRUD + read-only AI config), plus folding in the deferred polish from 6A/6B.

**Architecture:** Server components fetch data and render; the two interactive surfaces (Ask panel, Insights generator) are client components that call the existing `/api/ask` (POST) and `/api/insights` (GET) routes. Settings mutations go through new `"use server"` actions wrapping new repo functions, with `revalidatePath`. AI answers and insight summaries are Markdown, rendered by a small dependency-light `Markdown` wrapper around `react-markdown`. Generation is **explicit** (a button), never automatic on navigation, to bound AI cost.

**Tech Stack:** Next.js 15 (App Router, server components + server actions), React 19 (`useTransition`, `useState`, `useEffect`), TypeScript strict, Tailwind v4, `react-markdown` (new dep), Recharts (existing), Supabase (`createAdminClient`), Vitest + Testing Library (jsdom unit tests `*.test.tsx`; local-Supabase integration tests `*.itest.ts`).

---

## File Structure

**New files**
- `components/ui/markdown.tsx` — Markdown renderer (react-markdown + Tailwind-utility component overrides; no `@tailwindcss/typography`).
- `components/ask/ask-panel.tsx` — client; floating "Ask AI" button + slide-over + `/`-key open / `Esc` close; POSTs `/api/ask`.
- `components/insights/insights-view.tsx` — client; period selector + explicit "Generate"/"Refresh" button; GETs `/api/insights`; renders summary Markdown + supporting numbers.
- `lib/settings/usage.ts` — `getUsageStats(db)` → counts of Q&A + insights rows (cheap COUNT, head-only).
- `app/(app)/settings/actions.ts` — `"use server"` mutations for accounts/categories/import-profiles.
- `components/settings/accounts-section.tsx` — client; accounts list + create/rename/delete.
- `components/settings/categories-section.tsx` — client; categories list + create/rename/recolor/delete.
- `components/settings/import-profiles-section.tsx` — client; saved bank-layout list + delete.
- `components/settings/ai-config-section.tsx` — server; read-only models + usage counts.
- Tests: `components/ui/__tests__/markdown.test.tsx`, `components/ask/__tests__/ask-panel.test.tsx`, `components/insights/__tests__/insights-view.test.tsx`, `components/settings/__tests__/accounts-section.test.tsx`, `lib/__tests__/format.test.ts` (extend), `lib/repos/__tests__/accounts.itest.ts`, `lib/repos/__tests__/categories.itest.ts`, `lib/repos/__tests__/imports.itest.ts`, `lib/settings/__tests__/usage.itest.ts`.

**Modified files**
- `lib/format.ts` — add `currentMonth(now?)`.
- `app/(app)/page.tsx` — use the shared `currentMonth()` (remove the local copy).
- `app/(app)/layout.tsx` — mount `<AskPanel />`.
- `app/(app)/insights/page.tsx` — replace placeholder with real page.
- `app/(app)/settings/page.tsx` — replace placeholder with real page.
- `lib/repos/accounts.ts` — add `listAccountsWithCounts`, `renameAccount`, `deleteAccount`.
- `lib/repos/categories.ts` — add `CategoryWithCount`, `listCategoriesWithCounts`, `createCategory`, `renameCategory`, `recolorCategory`, `deleteCategory`.
- `lib/repos/imports.ts` — add `ImportProfileSummary`, `listProfiles`, `deleteProfile`.
- `lib/repos/transactions.ts` — add a stable secondary sort to `listTransactions`.
- `components/charts/category-donut.tsx` — add a legend.
- `components/transactions/transactions-filters.tsx` — resync the search box to the URL on back/forward.
- `components/ui/select.tsx` — add `Select.displayName`.

---

## Task 0: Add the `react-markdown` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run (in the worktree root):
```bash
npm install react-markdown@^9.0.1
```
Expected: `package.json` `dependencies` gains `"react-markdown": "^9.0.1"`, and `package-lock.json` updates. No peer-dependency errors (react-markdown 9 accepts React >= 18, satisfied by React 19).

- [ ] **Step 2: Verify the install**

Run: `npm ls react-markdown`
Expected: prints `react-markdown@9.x.x` (no "missing"/"invalid").

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add react-markdown for AI answer/insight rendering"
```

---

## Task 1: `currentMonth()` helper (DRY the month computation)

**Files:**
- Modify: `lib/format.ts`
- Modify: `app/(app)/page.tsx:11-14` (remove the local `currentMonth`)
- Test: `lib/__tests__/format.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Append to `lib/__tests__/format.test.ts`:
```ts
import { currentMonth } from "@/lib/format";

describe("currentMonth", () => {
  it("formats a Date as YYYY-MM in UTC", () => {
    expect(currentMonth(new Date("2026-06-02T00:00:00Z"))).toBe("2026-06");
  });
  it("zero-pads single-digit months", () => {
    expect(currentMonth(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- format`
Expected: FAIL — `currentMonth` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/format.ts`:
```ts
/** The current month as "YYYY-MM" (UTC). Pass a fixed Date in tests for determinism. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Use it in the dashboard page**

In `app/(app)/page.tsx`, delete the local `function currentMonth() {...}` (lines 11-14) and import the shared one. The import line becomes:
```ts
import { currentMonth } from "@/lib/format";
```
(Add it alongside the other imports; the `getDashboardData(db, { month: currentMonth() })` call is unchanged.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- format`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/format.ts lib/__tests__/format.test.ts "app/(app)/page.tsx"
git commit -m "refactor(format): extract shared currentMonth() helper"
```

---

## Task 2: `Markdown` renderer component

**Files:**
- Create: `components/ui/markdown.tsx`
- Test: `components/ui/__tests__/markdown.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/ui/markdown";

describe("Markdown", () => {
  it("renders bold and bullet lists", () => {
    render(<Markdown>{"You spent **a lot**.\n\n- groceries\n- rent"}</Markdown>);
    expect(screen.getByText("a lot").tagName).toBe("STRONG");
    expect(screen.getByText("groceries").closest("li")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- markdown`
Expected: FAIL — cannot resolve `@/components/ui/markdown`.

- [ ] **Step 3: Implement**

```tsx
import ReactMarkdown from "react-markdown";

/**
 * Dependency-light Markdown renderer for AI answers and insight summaries.
 * We don't use @tailwindcss/typography, so each element is styled with our own
 * Tailwind utilities. react-markdown does not render raw HTML by default, so this
 * is safe to feed model output into.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          a: ({ href, children }) => (
            <a href={href} className="text-blue-600 underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ children }) => <code className="bg-muted rounded px-1 py-0.5 text-xs">{children}</code>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npm test -- markdown`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/ui/markdown.tsx components/ui/__tests__/markdown.test.tsx
git commit -m "feat(ui): add dependency-light Markdown renderer"
```

---

## Task 3: Ask panel (NL Q&A slide-over)

**Files:**
- Create: `components/ask/ask-panel.tsx`
- Test: `components/ask/__tests__/ask-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskPanel } from "@/components/ask/ask-panel";

describe("AskPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens when '/' is pressed and submits a question", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ answer: "You spent **PLN 100**.", toolCalls: [] }),
    });
    render(<AskPanel />);
    // panel is closed initially
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "/" });
    const textarea = await screen.findByPlaceholderText(/how much did i spend/i);
    await userEvent.type(textarea, "How much?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(screen.getByText("PLN 100").tagName).toBe("STRONG"));
    expect(fetch).toHaveBeenCalledWith("/api/ask", expect.objectContaining({ method: "POST" }));
  });

  it("shows an error message when the request fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Sorry, I couldn't answer that." }),
    });
    render(<AskPanel />);
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
    const textarea = await screen.findByPlaceholderText(/how much did i spend/i);
    await userEvent.type(textarea, "bad");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Sorry, I couldn't answer that.")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- ask-panel`
Expected: FAIL — cannot resolve `@/components/ask/ask-panel`.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";

interface AskResponse {
  answer: string;
  toolCalls: { name: string; input: unknown }[];
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Floating "Ask AI" button + slide-over panel. Opens on the "/" key (unless typing) and closes on Escape. */
export function AskPanel() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !open && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const submit = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as AskResponse | { error: string };
      if (!res.ok || "error" in data) {
        setError(("error" in data && data.error) || "Something went wrong.");
      } else {
        setAnswer(data.answer);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [question, loading]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-foreground text-background fixed right-6 bottom-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm shadow-lg hover:opacity-90"
        aria-label="Ask AI"
      >
        <Sparkles className="size-4" />
        Ask AI
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Ask AI">
          <div className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
          <div className="bg-background flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Ask about your money</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="flex flex-col gap-2"
            >
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="e.g. How much did I spend on groceries last month?"
                rows={3}
                className="focus:ring-ring w-full rounded-md border bg-background p-3 text-sm focus:ring-2 focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !question.trim()}
                className="bg-foreground text-background self-end rounded-md px-4 py-2 text-sm disabled:opacity-50"
              >
                {loading ? "Thinking…" : "Ask"}
              </button>
            </form>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {answer ? (
              <div className="bg-muted/30 rounded-md border p-4">
                <Markdown>{answer}</Markdown>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run the tests + typecheck + lint**

Run: `npm test -- ask-panel`
Expected: PASS (both tests).
Run: `npm run typecheck`
Expected: no errors.
Run: `npm run lint`
Expected: no errors (note: `'/'`-key handler and `void submit()` are intentional).

- [ ] **Step 5: Commit**

```bash
git add components/ask/ask-panel.tsx components/ask/__tests__/ask-panel.test.tsx
git commit -m "feat(ask): NL Q&A slide-over panel over /api/ask"
```

---

## Task 4: Mount the Ask panel in the app layout

**Files:**
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Add the import + mount**

Edit `app/(app)/layout.tsx`. Add the import:
```ts
import { AskPanel } from "@/components/ask/ask-panel";
```
And render `<AskPanel />` inside the root flex container, after `</main>`:
```tsx
  return (
    <div className="flex min-h-screen">
      <AppSidebar email={user?.email ?? ""} />
      <main className="flex-1 overflow-x-hidden p-6 md:p-8">{children}</main>
      <AskPanel />
    </div>
  );
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds (the layout renders the client `AskPanel` on every `(app)` route).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/layout.tsx"
git commit -m "feat(ask): mount Ask panel app-wide in (app) layout"
```

---

## Task 5: Insights view (client)

**Files:**
- Create: `components/insights/insights-view.tsx`
- Test: `components/insights/__tests__/insights-view.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsightsView } from "@/components/insights/insights-view";

const RESPONSE = {
  period: "2026-06",
  summaryMd: "You spent **a bit less** this month.",
  cached: false,
  stats: {
    periodLabel: "June 2026",
    currency: "PLN",
    totalSpentMinor: -120000,
    totalIncomeMinor: 500000,
    byCategory: [{ category: "Groceries", spentMinor: -80000 }],
    vsPrevious: [{ category: "Groceries", deltaPct: -12 }],
    topMerchants: [{ merchant: "BIEDRONKA", spentMinor: -50000 }],
    newMerchants: ["NETFLIX"],
  },
};

describe("InsightsView", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("generates on demand and renders the summary + supporting numbers", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => RESPONSE });
    render(<InsightsView months={["2026-06", "2026-05"]} defaultPeriod="2026-06" />);

    expect(screen.queryByText(/a bit less/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(screen.getByText("a bit less").tagName).toBe("STRONG"));
    expect(screen.getByText("BIEDRONKA")).toBeInTheDocument();
    expect(screen.getByText("NETFLIX")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/insights?period=2026-06");
  });

  it("shows an error when generation fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Could not generate insights for that period." }),
    });
    render(<InsightsView months={["2026-06"]} defaultPeriod="2026-06" />);
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText("Could not generate insights for that period.")).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- insights-view`
Expected: FAIL — cannot resolve `@/components/insights/insights-view`.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/ui/markdown";
import { formatMoneyMinor, shortMonthLabel } from "@/lib/format";
import type { InsightStatPack } from "@/lib/ai/insights";

interface InsightResponse {
  period: string;
  summaryMd: string;
  stats: InsightStatPack;
  cached: boolean;
}

function monthLabel(period: string): string {
  const [, mm] = period.split("-");
  return `${shortMonthLabel(period)} ${period.slice(0, 4)}`.replace(mm, mm); // e.g. "Jun 2026"
}

export function InsightsView({ months, defaultPeriod }: { months: string[]; defaultPeriod: string }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const [data, setData] = useState<InsightResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?period=${period}`);
      const json = (await res.json()) as InsightResponse | { error: string };
      if (!res.ok || "error" in json) {
        setError(("error" in json && json.error) || "Could not generate insights.");
        setData(null);
      } else {
        setData(json);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const stats = data?.stats;
  const currency = stats?.currency ?? "PLN";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setData(null);
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="bg-foreground text-background rounded-md px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Generating…" : data ? "Refresh" : "Generate insights"}
        </button>
        {data?.cached ? <span className="text-muted-foreground text-xs">cached</span> : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!data && !loading && !error ? (
        <p className="text-muted-foreground text-sm">
          Pick a month and generate a short AI summary of your spending.
        </p>
      ) : null}

      {stats ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Summary — {stats.periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <Markdown>{data!.summaryMd}</Markdown>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Totals</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span>Spent</span>
                  <span className="font-medium">{formatMoneyMinor(stats.totalSpentMinor, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Income</span>
                  <span className="text-emerald-600 font-medium">
                    {formatMoneyMinor(stats.totalIncomeMinor, currency)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top merchants</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {stats.topMerchants.length === 0 ? (
                  <span className="text-muted-foreground">No spending.</span>
                ) : (
                  stats.topMerchants.map((m) => (
                    <div key={m.merchant} className="flex justify-between">
                      <span>{m.merchant}</span>
                      <span className="font-medium">{formatMoneyMinor(m.spentMinor, currency)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Biggest changes vs last month</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {stats.vsPrevious.length === 0 ? (
                  <span className="text-muted-foreground">No comparable categories.</span>
                ) : (
                  stats.vsPrevious
                    .slice()
                    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
                    .slice(0, 5)
                    .map((c) => (
                      <div key={c.category} className="flex justify-between">
                        <span>{c.category}</span>
                        <span className={c.deltaPct >= 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>
                          {c.deltaPct >= 0 ? "+" : ""}
                          {c.deltaPct}%
                        </span>
                      </div>
                    ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>New merchants</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {stats.newMerchants.length === 0 ? (
                  <span className="text-muted-foreground">None.</span>
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    {stats.newMerchants.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
```

> Note: keep `monthLabel` simple — replace its body with `return \`${shortMonthLabel(period)} ${period.slice(0, 4)}\`;` (the `.replace` shown above is a no-op kept only to avoid an unused-var lint on `mm`; if you inline it, also remove the `const [, mm]` destructure). Either form must produce e.g. `"Jun 2026"`.

- [ ] **Step 4: Simplify `monthLabel`**

Replace the `monthLabel` function with:
```tsx
function monthLabel(period: string): string {
  return `${shortMonthLabel(period)} ${period.slice(0, 4)}`;
}
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `npm test -- insights-view`
Expected: PASS (both tests).
Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/insights/insights-view.tsx components/insights/__tests__/insights-view.test.tsx
git commit -m "feat(insights): on-demand insights view over /api/insights"
```

---

## Task 6: Insights page (server)

**Files:**
- Modify: `app/(app)/insights/page.tsx`

- [ ] **Step 1: Replace the placeholder**

Overwrite `app/(app)/insights/page.tsx`:
```tsx
import { InsightsView } from "@/components/insights/insights-view";
import { currentMonth, lastNMonths } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  const month = currentMonth();
  const months = lastNMonths(month, 12).slice().reverse(); // newest first for the dropdown

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Insights</h1>
      <InsightsView months={months} defaultPeriod={month} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/insights/page.tsx"
git commit -m "feat(insights): wire the insights page (period picker + view)"
```

---

## Task 7: Accounts repo — counts, rename, delete (guarded)

**Files:**
- Modify: `lib/repos/accounts.ts`
- Test: `lib/repos/__tests__/accounts.itest.ts`

- [ ] **Step 1: Write the failing integration test**

Create `lib/repos/__tests__/accounts.itest.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAccount,
  deleteAccount,
  listAccountsWithCounts,
  renameAccount,
} from "@/lib/repos/accounts";

const db = createAdminClient();
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.from("transactions").delete().eq("account_id", id);
    await db.from("accounts").delete().eq("id", id);
  }
});

describe("accounts repo (integration)", () => {
  it("creates, lists with a zero count, renames", async () => {
    const id = await createAccount(db, { name: "Test Checking", currency: "PLN" });
    created.push(id);

    const before = await listAccountsWithCounts(db);
    const row = before.find((a) => a.id === id);
    expect(row).toBeTruthy();
    expect(row!.transactionCount).toBe(0);

    await renameAccount(db, id, "Renamed");
    const after = await listAccountsWithCounts(db);
    expect(after.find((a) => a.id === id)!.name).toBe("Renamed");
  });

  it("deletes an empty account but refuses one with transactions", async () => {
    const id = await createAccount(db, { name: "HasTxns", currency: "PLN" });
    created.push(id);
    await db.from("transactions").insert({
      account_id: id,
      booked_at: "2026-06-01",
      amount_minor: -1000,
      currency: "PLN",
      raw_description: "x",
      dedup_hash: "acc-itest-hash-1",
    });

    await expect(deleteAccount(db, id)).rejects.toThrow(/transaction/i);

    await db.from("transactions").delete().eq("account_id", id);
    await expect(deleteAccount(db, id)).resolves.toBeUndefined();
    created.splice(created.indexOf(id), 1); // already deleted
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:integration -- accounts`
Expected: FAIL — `listAccountsWithCounts` / `renameAccount` / `deleteAccount` not exported.

- [ ] **Step 3: Implement**

Append to `lib/repos/accounts.ts`:
```ts
export interface AccountWithCount extends Account {
  transactionCount: number;
}

/** Accounts with their transaction counts, oldest first (for the Settings page). */
export async function listAccountsWithCounts(db: Db): Promise<AccountWithCount[]> {
  const { data, error } = await db
    .from("accounts")
    .select("id, name, currency, transactions(count)")
    .order("created_at")
    .returns<{ id: string; name: string; currency: string; transactions: { count: number }[] }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    transactionCount: a.transactions[0]?.count ?? 0,
  }));
}

/** Rename an account. */
export async function renameAccount(db: Db, id: string, name: string): Promise<void> {
  const { error } = await db.from("accounts").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Delete an account. Refuses if it still has transactions — the FK is ON DELETE
 * CASCADE, so deleting an account with transactions would silently destroy them.
 */
export async function deleteAccount(db: Db, id: string): Promise<void> {
  const { count, error } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) {
    throw new Error(`This account has ${count} transactions. Delete or reassign them before removing the account.`);
  }
  const { error: delErr } = await db.from("accounts").delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);
}
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- accounts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repos/accounts.ts lib/repos/__tests__/accounts.itest.ts
git commit -m "feat(repos): accounts list-with-counts, rename, guarded delete"
```

---

## Task 8: Categories repo — counts, create, rename, recolor, delete (guarded)

**Files:**
- Modify: `lib/repos/categories.ts`
- Test: `lib/repos/__tests__/categories.itest.ts`

- [ ] **Step 1: Write the failing integration test**

Create `lib/repos/__tests__/categories.itest.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCategory,
  deleteCategory,
  listCategoriesWithCounts,
  recolorCategory,
  renameCategory,
} from "@/lib/repos/categories";

const db = createAdminClient();
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.from("categories").delete().eq("id", id);
  }
});

describe("categories repo (integration)", () => {
  it("creates, lists with count + isSystem, renames, recolors", async () => {
    const id = await createCategory(db, { name: "ZZ Test Cat", kind: "expense", color: "#123456" });
    created.push(id);

    const list = await listCategoriesWithCounts(db);
    const row = list.find((c) => c.id === id);
    expect(row).toBeTruthy();
    expect(row!.isSystem).toBe(false);
    expect(row!.transactionCount).toBe(0);

    await renameCategory(db, id, "ZZ Renamed Cat");
    await recolorCategory(db, id, "#abcdef");
    const after = await listCategoriesWithCounts(db);
    const updated = after.find((c) => c.id === id)!;
    expect(updated.name).toBe("ZZ Renamed Cat");
    expect(updated.color).toBe("#abcdef");
  });

  it("rejects a duplicate name", async () => {
    const id = await createCategory(db, { name: "ZZ Dupe", kind: "expense" });
    created.push(id);
    await expect(createCategory(db, { name: "ZZ Dupe", kind: "expense" })).rejects.toThrow();
  });

  it("refuses to delete a system category", async () => {
    const list = await listCategoriesWithCounts(db);
    const sys = list.find((c) => c.isSystem);
    expect(sys).toBeTruthy();
    await expect(deleteCategory(db, sys!.id)).rejects.toThrow(/system/i);
  });

  it("deletes a user category", async () => {
    const id = await createCategory(db, { name: "ZZ Deleteme", kind: "expense" });
    await expect(deleteCategory(db, id)).resolves.toBeUndefined();
    // not pushed to `created` — already gone
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:integration -- categories`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Implement**

Append to `lib/repos/categories.ts`:
```ts
export interface CategoryWithCount extends Category {
  isSystem: boolean;
  transactionCount: number;
}

/** Categories with transaction counts + system flag, ordered by name (Settings page). */
export async function listCategoriesWithCounts(db: Db): Promise<CategoryWithCount[]> {
  const { data, error } = await db
    .from("categories")
    .select("id, name, kind, color, is_system, transactions(count)")
    .order("name")
    .returns<
      {
        id: string;
        name: string;
        kind: string;
        color: string | null;
        is_system: boolean;
        transactions: { count: number }[];
      }[]
    >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind as Category["kind"],
    color: c.color,
    isSystem: c.is_system,
    transactionCount: c.transactions[0]?.count ?? 0,
  }));
}

/** Create a category; returns its id. Throws on a duplicate name (unique constraint). */
export async function createCategory(
  db: Db,
  input: { name: string; kind: Category["kind"]; color?: string | null },
): Promise<string> {
  const { data, error } = await db
    .from("categories")
    .insert({ name: input.name, kind: input.kind, color: input.color ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Rename a category. Throws on a duplicate name. */
export async function renameCategory(db: Db, id: string, name: string): Promise<void> {
  const { error } = await db.from("categories").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Change a category's color (null clears it). */
export async function recolorCategory(db: Db, id: string, color: string | null): Promise<void> {
  const { error } = await db.from("categories").update({ color }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Delete a category. Refuses system categories (they're part of the seeded
 * taxonomy). For user categories, the DB handles dependents: transactions.category_id
 * is SET NULL and merchant_map rows CASCADE-delete.
 */
export async function deleteCategory(db: Db, id: string): Promise<void> {
  const { data, error } = await db.from("categories").select("is_system").eq("id", id).single();
  if (error) throw new Error(error.message);
  if (data.is_system) throw new Error("System categories can't be deleted.");
  const { error: delErr } = await db.from("categories").delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);
}
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- categories`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repos/categories.ts lib/repos/__tests__/categories.itest.ts
git commit -m "feat(repos): categories CRUD (counts, create, rename, recolor, guarded delete)"
```

---

## Task 9: Import-profiles repo — list + delete

**Files:**
- Modify: `lib/repos/imports.ts`
- Test: `lib/repos/__tests__/imports.itest.ts`

- [ ] **Step 1: Write the failing integration test**

Create `lib/repos/__tests__/imports.itest.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteProfile, listProfiles, saveProfile } from "@/lib/repos/imports";

const db = createAdminClient();
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.from("import_profiles").delete().eq("id", id);
  }
});

describe("import profiles repo (integration)", () => {
  it("lists a saved profile then deletes it", async () => {
    const id = await saveProfile(db, {
      headerSignature: "itest-sig|date|amount|desc",
      columnMapping: { date: "date", amount: "amount", description: "desc" },
      delimiter: ",",
      encoding: "utf-8",
    });
    created.push(id);

    const list = await listProfiles(db);
    const row = list.find((p) => p.id === id);
    expect(row).toBeTruthy();
    expect(row!.headerSignature).toContain("itest-sig");

    await deleteProfile(db, id);
    const after = await listProfiles(db);
    expect(after.find((p) => p.id === id)).toBeUndefined();
    created.splice(created.indexOf(id), 1);
  });
});
```

> Note: `ColumnMapping`'s exact field names come from `@/lib/domain/types`. If the object literal above fails to typecheck, match it to that type (the integration test compiles against the real type).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:integration -- imports`
Expected: FAIL — `listProfiles` / `deleteProfile` not exported.

- [ ] **Step 3: Implement**

Append to `lib/repos/imports.ts`:
```ts
export interface ImportProfileSummary {
  id: string;
  headerSignature: string;
  delimiter: string | null;
  encoding: string | null;
  createdAt: string;
}

/** All saved bank-layout profiles, newest first (for the Settings page). */
export async function listProfiles(db: Db): Promise<ImportProfileSummary[]> {
  const { data, error } = await db
    .from("import_profiles")
    .select("id, header_signature, delimiter, encoding, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id,
    headerSignature: p.header_signature,
    delimiter: p.delimiter,
    encoding: p.encoding,
    createdAt: p.created_at,
  }));
}

/** Delete a saved bank-layout profile. */
export async function deleteProfile(db: Db, id: string): Promise<void> {
  const { error } = await db.from("import_profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- imports`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repos/imports.ts lib/repos/__tests__/imports.itest.ts
git commit -m "feat(repos): import-profile list + delete"
```

---

## Task 10: Usage stats lib (read-only AI usage counters)

**Files:**
- Create: `lib/settings/usage.ts`
- Test: `lib/settings/__tests__/usage.itest.ts`

- [ ] **Step 1: Write the failing integration test**

Create `lib/settings/__tests__/usage.itest.ts`:
```ts
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:integration -- usage`
Expected: FAIL — cannot resolve `@/lib/settings/usage`.

- [ ] **Step 3: Implement**

Create `lib/settings/usage.ts`:
```ts
import type { Db } from "@/lib/supabase/admin";

export interface UsageStats {
  qaCount: number;
  insightCount: number;
}

/** Cheap COUNT(*) of logged Q&A interactions and cached insights (for the Settings page). */
export async function getUsageStats(db: Db): Promise<UsageStats> {
  const [qa, ins] = await Promise.all([
    db.from("qa_history").select("id", { count: "exact", head: true }),
    db.from("insights").select("id", { count: "exact", head: true }),
  ]);
  if (qa.error) throw new Error(qa.error.message);
  if (ins.error) throw new Error(ins.error.message);
  return { qaCount: qa.count ?? 0, insightCount: ins.count ?? 0 };
}
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- usage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/settings/usage.ts lib/settings/__tests__/usage.itest.ts
git commit -m "feat(settings): AI usage counters (qa_history + insights counts)"
```

---

## Task 11: Settings server actions

**Files:**
- Create: `app/(app)/settings/actions.ts`

- [ ] **Step 1: Implement the actions**

Create `app/(app)/settings/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAccount as repoCreateAccount,
  deleteAccount as repoDeleteAccount,
  renameAccount as repoRenameAccount,
} from "@/lib/repos/accounts";
import {
  createCategory as repoCreateCategory,
  deleteCategory as repoDeleteCategory,
  recolorCategory as repoRecolorCategory,
  renameCategory as repoRenameCategory,
  type Category,
} from "@/lib/repos/categories";
import { deleteProfile as repoDeleteProfile } from "@/lib/repos/imports";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : "Something went wrong.";
  if (msg.includes("categories_name_key")) {
    return { ok: false, error: "A category with that name already exists." };
  }
  return { ok: false, error: msg };
}

// --- Accounts ---

export async function createAccountAction(input: { name: string; currency: string }): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoCreateAccount(createAdminClient(), {
      name: input.name.trim(),
      currency: input.currency.trim() || "PLN",
    });
    revalidatePath("/settings");
    revalidatePath("/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameAccountAction(input: { id: string; name: string }): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoRenameAccount(createAdminClient(), input.id, input.name.trim());
    revalidatePath("/settings");
    revalidatePath("/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccountAction(input: { id: string }): Promise<ActionResult> {
  try {
    await repoDeleteAccount(createAdminClient(), input.id);
    revalidatePath("/settings");
    revalidatePath("/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- Categories ---

export async function createCategoryAction(input: {
  name: string;
  kind: Category["kind"];
  color: string | null;
}): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoCreateCategory(createAdminClient(), {
      name: input.name.trim(),
      kind: input.kind,
      color: input.color,
    });
    revalidatePath("/settings");
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameCategoryAction(input: { id: string; name: string }): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoRenameCategory(createAdminClient(), input.id, input.name.trim());
    revalidatePath("/settings");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function recolorCategoryAction(input: { id: string; color: string | null }): Promise<ActionResult> {
  try {
    await repoRecolorCategory(createAdminClient(), input.id, input.color);
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCategoryAction(input: { id: string }): Promise<ActionResult> {
  try {
    await repoDeleteCategory(createAdminClient(), input.id);
    revalidatePath("/settings");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- Import profiles ---

export async function deleteProfileAction(input: { id: string }): Promise<ActionResult> {
  try {
    await repoDeleteProfile(createAdminClient(), input.id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
```

> Note: this imports `type Category` from `@/lib/repos/categories`. That type is already exported there (the `Category` interface). No change needed in the categories repo for the type import.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/settings/actions.ts"
git commit -m "feat(settings): server actions for accounts/categories/profiles"
```

---

## Task 12: Accounts settings section (client) + test

**Files:**
- Create: `components/settings/accounts-section.tsx`
- Test: `components/settings/__tests__/accounts-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsSection } from "@/components/settings/accounts-section";

vi.mock("@/app/(app)/settings/actions", () => ({
  createAccountAction: vi.fn(async () => ({ ok: true })),
  renameAccountAction: vi.fn(async () => ({ ok: true })),
  deleteAccountAction: vi.fn(async () => ({ ok: false, error: "This account has 3 transactions." })),
}));

import {
  createAccountAction,
  deleteAccountAction,
} from "@/app/(app)/settings/actions";

afterEach(() => vi.clearAllMocks());

const ACCOUNTS = [
  { id: "a1", name: "Checking", currency: "PLN", transactionCount: 3 },
  { id: "a2", name: "Savings", currency: "PLN", transactionCount: 0 },
];

describe("AccountsSection", () => {
  it("creates an account", async () => {
    render(<AccountsSection accounts={ACCOUNTS} />);
    await userEvent.type(screen.getByPlaceholderText(/new account name/i), "Cash");
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    await waitFor(() =>
      expect(createAccountAction).toHaveBeenCalledWith(expect.objectContaining({ name: "Cash" })),
    );
  });

  it("surfaces a delete error for an account with transactions", async () => {
    render(<AccountsSection accounts={ACCOUNTS} />);
    // Checking has 3 transactions -> its delete button triggers the guarded error
    fireEvent.click(screen.getAllByRole("button", { name: /delete account/i })[0]);
    await waitFor(() => expect(deleteAccountAction).toHaveBeenCalledWith({ id: "a1" }));
    await waitFor(() => expect(screen.getByText(/3 transactions/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- accounts-section`
Expected: FAIL — cannot resolve `@/components/settings/accounts-section`.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { AccountWithCount } from "@/lib/repos/accounts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createAccountAction,
  deleteAccountAction,
  renameAccountAction,
} from "@/app/(app)/settings/actions";

export function AccountsSection({ accounts }: { accounts: AccountWithCount[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("PLN");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">Accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <input
                defaultValue={a.name}
                disabled={pending}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== a.name) run(() => renameAccountAction({ id: a.id, name: v }));
                }}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                aria-label={`Account name for ${a.name}`}
              />
              <span className="text-muted-foreground w-28 text-right text-xs">
                {a.currency} · {a.transactionCount} txns
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteAccountAction({ id: a.id }))}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                aria-label={`Delete account ${a.name}`}
              >
                Delete
              </button>
            </li>
          ))}
          {accounts.length === 0 ? <li className="text-muted-foreground text-sm">No accounts yet.</li> : null}
        </ul>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(async () => {
              const res = await createAccountAction({ name, currency });
              if (res.ok) setName("");
              return res;
            });
          }}
          className="flex flex-wrap items-center gap-2 border-t pt-4"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New account name"
            disabled={pending}
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
          />
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="PLN"
            maxLength={3}
            disabled={pending}
            className="h-9 w-20 rounded-md border bg-background px-3 text-sm uppercase"
            aria-label="Currency"
          />
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="bg-foreground text-background rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            Add account
          </button>
        </form>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `npm test -- accounts-section`
Expected: PASS (both tests).
Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/settings/accounts-section.tsx components/settings/__tests__/accounts-section.test.tsx
git commit -m "feat(settings): accounts section (create/rename/delete)"
```

---

## Task 13: Categories settings section (client)

**Files:**
- Create: `components/settings/categories-section.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { CategoryWithCount, Category } from "@/lib/repos/categories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  createCategoryAction,
  deleteCategoryAction,
  recolorCategoryAction,
  renameCategoryAction,
} from "@/app/(app)/settings/actions";

const KINDS: Category["kind"][] = ["expense", "income", "transfer"];

export function CategoriesSection({ categories }: { categories: CategoryWithCount[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [color, setColor] = useState("#0a84ff");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">Categories</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <input
                type="color"
                defaultValue={c.color ?? "#888888"}
                disabled={pending}
                onChange={(e) => run(() => recolorCategoryAction({ id: c.id, color: e.target.value }))}
                className="h-8 w-10 rounded border"
                aria-label={`Color for ${c.name}`}
              />
              <input
                defaultValue={c.name}
                disabled={pending || c.isSystem}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) run(() => renameCategoryAction({ id: c.id, name: v }));
                }}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm disabled:opacity-60"
                aria-label={`Category name for ${c.name}`}
              />
              <span className="text-muted-foreground w-32 text-right text-xs">
                {c.kind} · {c.transactionCount} txns
              </span>
              {c.isSystem ? (
                <span className="text-muted-foreground w-16 text-center text-xs">system</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (c.transactionCount > 0 && !window.confirm(`Delete "${c.name}"? ${c.transactionCount} transactions will become uncategorized.`)) {
                      return;
                    }
                    run(() => deleteCategoryAction({ id: c.id }));
                  }}
                  className="w-16 rounded-md border px-2 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  aria-label={`Delete category ${c.name}`}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(async () => {
              const res = await createCategoryAction({ name, kind, color });
              if (res.ok) setName("");
              return res;
            });
          }}
          className="flex flex-wrap items-center gap-2 border-t pt-4"
        >
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={pending}
            className="h-9 w-10 rounded border"
            aria-label="New category color"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name"
            disabled={pending}
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
          />
          <Select value={kind} onChange={(e) => setKind(e.target.value as Category["kind"])} disabled={pending}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="bg-foreground text-background rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            Add category
          </button>
        </form>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/settings/categories-section.tsx
git commit -m "feat(settings): categories section (create/rename/recolor/delete)"
```

---

## Task 14: Import-profiles settings section (client)

**Files:**
- Create: `components/settings/import-profiles-section.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { ImportProfileSummary } from "@/lib/repos/imports";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteProfileAction } from "@/app/(app)/settings/actions";

export function ImportProfilesSection({ profiles }: { profiles: ImportProfileSummary[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(id: string) {
    setError(null);
    start(async () => {
      const res = await deleteProfileAction({ id });
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">Saved bank layouts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {profiles.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None yet. The first time you map an unknown CSV, its layout is saved here for next time.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="flex-1 truncate font-mono text-xs" title={p.headerSignature}>
                  {p.headerSignature}
                </span>
                <span className="text-muted-foreground w-28 text-right text-xs">
                  {p.encoding ?? "?"} · {p.delimiter ? `“${p.delimiter}”` : "?"}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(p.id)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  aria-label="Delete saved layout"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/settings/import-profiles-section.tsx
git commit -m "feat(settings): saved bank-layout list + delete"
```

---

## Task 15: AI config settings section (server, read-only)

**Files:**
- Create: `components/settings/ai-config-section.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UsageStats } from "@/lib/settings/usage";

/** Read-only view of the configured models + cumulative AI usage. Server component:
 *  model IDs come from server-only env, so they're passed down as props, never
 *  imported into a client bundle. */
export function AiConfigSection({
  models,
  usage,
}: {
  models: { categorize: string; qa: string; insights: string };
  usage: UsageStats;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Categorization model", value: models.categorize },
    { label: "Q&A model", value: models.qa },
    { label: "Insights model", value: models.insights },
    { label: "Questions asked", value: String(usage.qaCount) },
    { label: "Insights generated", value: String(usage.insightCount) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">AI &amp; usage</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-mono">{r.value}</span>
          </div>
        ))}
        <p className="text-muted-foreground mt-2 text-xs">
          Models are configured via environment variables (ANTHROPIC_MODEL_*). Restart the app to change them.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/settings/ai-config-section.tsx
git commit -m "feat(settings): read-only AI config + usage section"
```

---

## Task 16: Settings page (server) — wire all sections

**Files:**
- Modify: `app/(app)/settings/page.tsx`

- [ ] **Step 1: Replace the placeholder**

Overwrite `app/(app)/settings/page.tsx`:
```tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { listAccountsWithCounts } from "@/lib/repos/accounts";
import { listCategoriesWithCounts } from "@/lib/repos/categories";
import { listProfiles } from "@/lib/repos/imports";
import { getUsageStats } from "@/lib/settings/usage";
import { MODELS } from "@/lib/ai/models";
import { AccountsSection } from "@/components/settings/accounts-section";
import { CategoriesSection } from "@/components/settings/categories-section";
import { ImportProfilesSection } from "@/components/settings/import-profiles-section";
import { AiConfigSection } from "@/components/settings/ai-config-section";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = createAdminClient();
  const [accounts, categories, profiles, usage] = await Promise.all([
    listAccountsWithCounts(db),
    listCategoriesWithCounts(db),
    listProfiles(db),
    getUsageStats(db),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <AccountsSection accounts={accounts} />
      <CategoriesSection categories={categories} />
      <ImportProfilesSection profiles={profiles} />
      <AiConfigSection
        models={{ categorize: MODELS.categorize, qa: MODELS.qa, insights: MODELS.insights }}
        usage={usage}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/settings/page.tsx"
git commit -m "feat(settings): wire the settings page (accounts/categories/profiles/AI)"
```

---

## Task 17: Folded-in polish (donut legend, filter resync, Select displayName, stable tx sort)

**Files:**
- Modify: `components/charts/category-donut.tsx`
- Modify: `components/transactions/transactions-filters.tsx`
- Modify: `components/ui/select.tsx`
- Modify: `lib/repos/transactions.ts:158-160`
- Test: `lib/repos/__tests__/transactions.itest.ts` (extend)

- [ ] **Step 1: Donut legend**

In `components/charts/category-donut.tsx`, wrap the existing chart in a flex column and add a legend listing each slice's color, category, and amount. Replace the returned JSX (the `<div className="h-64 w-full">...</div>`) with:
```tsx
  return (
    <div className="flex flex-col gap-3">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
              {slices.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => (typeof value === "number" ? formatMoneyMinor(-value, currency) : value)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground">{formatMoneyMinor(-s.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
```

- [ ] **Step 2: Filter search resync on back/forward**

In `components/transactions/transactions-filters.tsx`, add `useEffect` so the controlled search box follows the URL when the user navigates with the browser back/forward buttons. Add `useEffect` to the React import and insert this effect after the `useState`:
```tsx
  const merchantParam = params.get("merchant") ?? "";
  useEffect(() => {
    setSearch(merchantParam);
  }, [merchantParam]);
```
(Update the import to `import { useEffect, useState } from "react";`.)

- [ ] **Step 3: Select displayName**

In `components/ui/select.tsx`, after the `Select` definition, add:
```tsx
Select.displayName = "Select";
```

- [ ] **Step 4: Stable secondary sort for the transaction list**

In `lib/repos/transactions.ts`, in `listTransactions`, add a deterministic tiebreak so same-day rows have a stable order. Change:
```ts
    .order("booked_at", { ascending: false })
    .limit(Math.min(filter.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX))
```
to:
```ts
    .order("booked_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(filter.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX))
```

- [ ] **Step 5: Extend the transactions integration test with a same-day order assertion**

Append a test to `lib/repos/__tests__/transactions.itest.ts` (reuse the file's existing setup/cleanup helpers; create a throwaway account inline if the file doesn't already expose one):
```ts
import { listTransactions } from "@/lib/repos/transactions";
// (createAdminClient is already imported at the top of this file)

describe("listTransactions same-day ordering", () => {
  it("orders same-day rows newest-created first", async () => {
    const db = createAdminClient();
    const { data: acc } = await db.from("accounts").insert({ name: "SortAcc", currency: "PLN" }).select("id").single();
    const accountId = acc!.id;
    try {
      await db.from("transactions").insert([
        { account_id: accountId, booked_at: "2026-06-10", amount_minor: -100, currency: "PLN", raw_description: "first", dedup_hash: "sort-h1" },
        { account_id: accountId, booked_at: "2026-06-10", amount_minor: -200, currency: "PLN", raw_description: "second", dedup_hash: "sort-h2" },
      ]);
      const rows = await listTransactions(db, { accountId, limit: 10 });
      // both same booked_at; created_at desc => the second insert comes first
      expect(rows[0].rawDescription).toBe("second");
      expect(rows[1].rawDescription).toBe("first");
    } finally {
      await db.from("transactions").delete().eq("account_id", accountId);
      await db.from("accounts").delete().eq("id", accountId);
    }
  });
});
```

> Note: if `lib/repos/__tests__/transactions.itest.ts` already imports `createAdminClient` and `listTransactions`, do not duplicate the imports — just add the `describe` block.

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `npm test -- category-donut transactions-filters` (any existing unit tests for these still pass)
Run: `npm run test:integration -- transactions`
Expected: PASS (including the new same-day order test).
Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/charts/category-donut.tsx components/transactions/transactions-filters.tsx components/ui/select.tsx lib/repos/transactions.ts lib/repos/__tests__/transactions.itest.ts
git commit -m "polish: donut legend, filter resync, Select displayName, stable tx sort"
```

---

## Task 18: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit suite**

Run: `npm test`
Expected: all unit tests pass.

- [ ] **Step 2: Run the integration suite**

Run: `npm run test:integration`
Expected: all integration tests pass (requires local Supabase running + `.env.local`).

- [ ] **Step 3: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 4: Final commit (only if anything was left uncommitted)**

```bash
git status
# if clean, nothing to do
```

---

## Out of Scope (explicitly deferred)

- **Per-account currency in the import wizard** (6B #4): the wizard still defaults to the account's currency at import time; multi-currency selection in the wizard UI is deferred (single-currency PLN default works).
- **Editable model/budget config:** models stay env-configured; the "soft budget guard / API-call cap" from the spec remains optional and is not built (the AI section only *displays* usage). Budgets & goals are deferred per the spec.
- **6B test cleanup #5** (redundant test import) and **#6 Select displayName**: #6 is done here (Task 17); #5 is a test-only tidy left for a future cleanup pass.

---

## Self-Review

**Spec coverage (design spec §"Layout", §"Settings", §"Ask panel"):**
- Sidebar nav already exists (6A). Ask panel slide-over via button **and** `/` shortcut → Task 3 + 4. ✅
- Insights feed (cached monthly narrative + supporting numbers) → Tasks 5–6 (explicit generation to bound cost; `cached` badge shown). ✅
- Settings — accounts, categories, import profiles, model/budget config → Tasks 7–16 (CRUD + read-only AI/usage; budget guard intentionally deferred, see Out of Scope). ✅
- Markdown rendering of AI output → Tasks 0, 2. ✅

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step is complete. The only narrative notes are the two explicit "simplify this function" / "don't duplicate imports" guidance steps, which include the exact replacement code.

**Type consistency:** `AccountWithCount`, `CategoryWithCount`, `ImportProfileSummary`, `UsageStats`, `ActionResult`, `InsightStatPack`, `Category["kind"]` are defined before use; action names (`createAccountAction`, etc.) match between `actions.ts` (Task 11) and the section components (Tasks 12–14); `getUsageStats`/`MODELS` shapes match the settings page (Task 16). `currentMonth`/`lastNMonths`/`shortMonthLabel`/`formatMoneyMinor` all exist in `lib/format.ts` (Task 1 adds `currentMonth`).
