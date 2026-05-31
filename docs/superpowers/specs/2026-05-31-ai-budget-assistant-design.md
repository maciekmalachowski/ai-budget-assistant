# AI Budget Assistant — Design Spec

- **Date:** 2026-05-31
- **Status:** Approved (design) — ready for implementation planning
- **Owner:** maciej@automee.pl

## 1. Summary

A personal, single-user web app that turns bank-statement CSVs into an explained view of your spending. You import CSV exports, the app parses, deduplicates, and auto-categorizes the transactions, and Claude powers three things on top of the data: **auto-categorization**, **natural-language Q&A** ("how much did I spend eating out in March vs April?"), and **proactive insights** (monthly/weekly summaries and trend callouts). Hosted on Vercel + Supabase. No bank-account syncing — CSV import only.

## 2. Goals & Non-Goals

**Goals**
- Import transactions from CSV/statement exports of any bank.
- Auto-categorize transactions, learning from manual corrections.
- Answer plain-language questions computed from the real data.
- Generate cached, proactive monthly/weekly summaries and trends.
- A dashboard-first UI optimized for one person scanning their money.
- Keep AI cost negligible (cents to ~$1/month for typical single-user use).

**Non-Goals (v1 — deliberately out of scope)**
- Automatic bank syncing via aggregators (Plaid/GoCardless/Tink).
- Receipt/photo scanning.
- Anomaly & subscription detection as a dedicated feature.
- Multi-user / multi-tenant; public sign-up.
- Multi-currency FX conversion (amounts shown per currency; PLN is the primary reporting currency).
- Scheduled/emailed digests (insights are on-demand and cached).
- Mobile-native apps.

## 3. Users & Constraints

- **Single user** (the owner). No sign-up flow; the whole app sits behind one login.
- **Cloud-hosted**: accessible anywhere; data lives in Supabase (encrypted at rest, single-user locked).
- **Region:** Poland — CSV formats use Windows-1250 encoding, decimal comma, and `;` delimiters in some banks; the importer must handle these.
- **AI dependency:** requires an Anthropic Console API key (pay-as-you-go). Claude.ai consumer subscriptions do **not** provide API access.

## 4. Architecture Overview

Data flows in one direction: **Ingest → Store → Consume.**

```
1 · Ingest a statement
   Upload CSV → Parse & map columns → Normalize + dedup → Categorize (rules → AI fallback)
   (column mapping per bank is remembered)
                         │ saved to
2 · Store  —  Supabase (single-user locked)
   transactions · categories · merchant_map (learns) · accounts · import_batches
   · import_profiles · insights · qa_history   +   raw CSV files in Storage
                         │ powers
3 · Consume
   Dashboard (spend by category, trends, month-vs-month)
   Ask panel (NL Q&A — Claude tool-calls over your data)
   Insights feed (monthly/weekly highlights — cached AI summaries)
```

**Components**
- **Next.js app (App Router)** on Vercel — UI + server-side API routes/actions.
- **Supabase** — Postgres (data), Auth (single login), Storage (raw CSVs).
- **Claude (Anthropic SDK)** — server-side only; categorization, Q&A, insights.

Privacy note: only minimal transaction text (merchant, amount, date, category) is sent to Claude. There are no bank credentials anywhere in the system; merchant names can be redacted further if desired.

## 5. Key Approach Decisions

| Decision | Choice | Rationale | Main alternative |
|---|---|---|---|
| Data input | **CSV import only** | Works with any bank, no aggregator cost or live credentials | Bank sync (deferred) |
| Hosting | **Cloud: Vercel + Supabase** | Access anywhere, managed DB/auth/backups | Self-hosted / local |
| Audience | **Single user** | No multi-tenancy; minimal auth | Multi-user product (deferred) |
| Q&A computation | **AI tool-calling over safe query functions** | Predictable, testable, safe with financial data; covers most questions | LLM-generated SQL (text-to-SQL) — deferred |
| Categorization | **Hybrid: learned merchant→category rules first, AI for unknowns** | Cheap, fast, deterministic for repeats; corrections become rules | AI classifies every transaction |
| Insights | **On-demand, cached** | No scheduling infra; regenerate when data changes | Scheduled background digests — deferred |

## 6. Data Model

Eight tables. Everything hangs off **transactions**. Single-user, so **no `user_id` columns** — the whole app is behind one login and RLS is "authenticated → full access." Money is stored as `numeric`, never floats.

**accounts** — bank/card accounts
- `id` (PK), `name` ("mBank checking", "Revolut"), `currency` (default `PLN`), `created_at`

**categories** — spending buckets
- `id` (PK), `name` ("Groceries"), `kind` (`expense` | `income` | `transfer`), `color`, `is_system` (seeded vs user-created)

**transactions** — the hub; every imported line item
- `id` (PK), `account_id` (FK→accounts), `booked_at` (date), `amount` (`numeric`, **signed**: − out, + in), `currency`, `raw_description` (original), `merchant` (normalized), `category_id` (FK→categories, nullable), `category_source` (`rule` | `ai` | `user` | `uncategorized`), `ai_confidence` (nullable), `import_batch_id` (FK→import_batches), `dedup_hash` (**unique per account**), `notes`, `created_at`, `updated_at`

**merchant_map** — learned categorization rules ("learns from me")
- `id` (PK), `match_type` (`exact` | `contains` | `regex`), `pattern` ("BIEDRONKA"), `category_id` (FK→categories), `source` (`user` | `ai` | `seed`), `hit_count`, `created_at`, `updated_at`

**import_batches** — one row per CSV upload
- `id` (PK), `account_id` (FK→accounts), `file_name`, `storage_path`, `column_mapping` (jsonb), `row_count`, `imported_count`, `duplicate_count`, `status` (`pending` | `mapped` | `imported` | `failed`), `created_at`

**import_profiles** — remembers a bank's CSV layout
- `id` (PK), `header_signature` (**unique**; fingerprint of the header row), `column_mapping` (jsonb), `date_format`, `delimiter`, `decimal_sep`, `encoding`, `created_at`

**insights** — cached AI summaries
- `id` (PK), `period_type` (`month` | `week`), `period_start` (date), `summary_md`, `stats` (jsonb — the numbers it was based on), `stale` (bool), `generated_at`

**qa_history** — Ask-panel log
- `id` (PK), `question`, `answer_md`, `tool_calls` (jsonb — what it queried), `created_at`

**Key model decisions**
- **Signed amount** (one column) rather than debit/credit — simpler, refunds work naturally.
- **`dedup_hash`** = hash(account + booked_at + amount + normalized description), unique per account, makes re-importing overlapping date ranges idempotent. Genuine same-day duplicates are preserved via an occurrence index folded into the hash input.
- **`merchant_map`** is the learning mechanism: correcting a category upserts a rule; `category_source = user` is **never** auto-overwritten by later imports.
- **`import_profiles`** keyed by header fingerprint: a known bank restores its mapping silently; an unknown one is mapped once, then saved.
- **`insights.stale`** invalidates a cached summary when new transactions land in its period.

## 7. CSV Import Flow

**Wizard (UI):** `Upload + pick account → Map columns → Review & import`. Mapping is a one-time-per-bank step (recognized formats auto-restore their mapping and can be skipped).

**Backend pipeline**
1. **Upload** — raw CSV → Supabase Storage; create `import_batch` (status `pending`); user selects the account.
2. **Detect format** — fingerprint the header row → look up `import_profiles`. Known ⇒ restore mapping (status `mapped`). Unknown ⇒ user maps columns once; save a new profile.
3. **Parse** — auto-detect delimiter (`;`/`,`), encoding (UTF-8 / Windows-1250), decimal comma + space/nbsp thousands; apply the date format; build a signed amount from one signed column **or** a Debit/Credit pair.
4. **Normalize** — derive a clean `merchant` from `raw_description`; compute `dedup_hash`.
5. **Dedup** — skip rows already imported for that account; count duplicates.
6. **Categorize** — apply `merchant_map` rules in-DB first; send only unknown merchants to Claude (batched) for `{category, confidence}`; low-confidence rows stay *Needs review*.
7. **Commit** — insert transactions; update batch counts + status `imported`.

**Edge cases**
- **Partial failures:** import the good rows, report bad rows per-row; never fail the whole file. Raw file retained; batch resumable.
- Changed bank layout → re-map + update the profile.
- Re-importing overlapping ranges → safe/idempotent via dedup.
- Multi-currency rows → store `currency` per transaction; no FX conversion in v1.

## 8. AI Mechanics

**Models & SDK** — Anthropic `@anthropic-ai/sdk`, **server-side only** (key never reaches the browser). Model IDs are **config-driven (env vars)** so they can be tuned/downshifted.
- **Categorization:** Claude **Haiku 4.5** (`claude-haiku-4-5`) — high-volume, simple, batched.
- **Q&A & insights:** Claude **Sonnet 4.6** (`claude-sonnet-4-6`) — better reasoning, cost-effective.
- **Prompt caching** on stable content (system prompt, category taxonomy, tool definitions) — ~90% off cached input.

**Categorization** — rules (`merchant_map`) run first in-DB and catch most rows; only unknown merchants go to Claude in **one batched call** returning `{category, confidence}` per item. Low-confidence ⇒ left *Needs review* rather than guessed. A manual correction upserts a rule; `category_source = user` is protected from overwrite.

**Q&A (tool-calling, not raw SQL)** — Claude is given a fixed set of **read-only** tools and chooses which to call with params:
- `totals(period, kind?, account?)`
- `spend_by_category(period, category?, account?)`
- `compare_periods(metric, period_a, period_b, dimension?)`
- `top_merchants(period, limit, category?)`
- `list_transactions(filters: date range, category, merchant, min/max amount, account)`

Each tool maps to a **parameterized, read-only, row-capped** SQL query. Claude never sees the raw DB and cannot write. It composes the answer from returned numbers; the question + tool calls are logged to `qa_history`. Inputs validated with Zod.

**Insights** — on viewing a period, if the `insights` cache is missing/stale, compute a compact stat pack (totals, category breakdown, period-over-period deltas, biggest movers, new merchants) and hand that JSON to Sonnet to write a short narrative. Cached; invalidated on new data in the period.

**Cost expectations (single user, current prices)**
- Categorizing ~200 txns/month ≈ **$0.05**; one insight ≈ **$0.02**; one Ask question ≈ **$0.02–0.03**.
- Monthly total dominated by Ask volume: light ≈ **$0.50**, moderate (~100 Q) ≈ **$2–3**, heavy (~300 Q) ≈ **$6–9**.
- A **$20** prepaid balance is plenty to start (credits typically expire ~12 months). Set a **Console spend cap + alert** as the real runaway-cost safeguard; the app adds guards (rules-first, cached insights, capped tool results).

## 9. UI / Screens

**Chosen layout: dashboard-first with a sidebar** (option A). Left sidebar nav (Dashboard, Transactions, Insights, Import, Settings); full-width content; the **Ask** panel opens as a slide-over via a button / `/` keyboard shortcut (always reachable, not occupying permanent space).

- **Dashboard** — KPI cards (spent this month, vs last month, top category), spend-by-category donut, 6-month trend, recent transactions, Ask button.
- **Transactions** — filterable/searchable table; inline category editing (which trains `merchant_map`); *Needs review* filter for low-confidence rows.
- **Insights** — cached monthly/weekly narrative summaries with the supporting numbers.
- **Import** — the 3-step wizard.
- **Settings** — accounts, categories, import profiles, model/budget config.
- **Login** — single-user auth.

## 10. Auth & Security

- Supabase Auth, **public sign-up disabled**; one account (recommend **magic-link** email login; password acceptable). Middleware redirects unauthenticated requests to `/login`.
- **RLS enabled on every table**; policy = "authenticated → full access" (single user). Server uses the service role for imports.
- Anthropic API key only in server environment; never exposed to the client. Q&A path uses a read-only DB role.

## 11. Error Handling & Edge Cases

- **Imports:** per-row error capture (good rows import, bad rows reported); raw file retained; idempotent via dedup; failed batches resumable.
- **AI:** timeouts + retry-with-backoff. Categorization failure ⇒ rows left *Uncategorized*, import still succeeds. Q&A failure ⇒ graceful "couldn't answer, try rephrasing" + logged. AI can never mutate data.
- **Tool calls:** Zod-validated params, capped result sizes, read-only role.
- **Money:** `numeric` only, never floats. Currency tracked per transaction.
- **Optional budget guard:** soft daily cap / counter on API calls to bound cost.

## 12. Testing Strategy

- **Vitest unit tests** for the gnarly logic: CSV parsing across bank formats/encodings/decimal-comma/debit-credit, dedup hashing, normalization, rules categorization, and each query function — backed by **anonymized sample-CSV fixtures**.
- **Anthropic client mocked** in tests; a small set of "golden" categorization cases.
- **Integration:** import pipeline end-to-end against a test Supabase; API route tests.
- **Playwright** (already in the repo's MCP tooling) smoke suite: import wizard happy path, ask a question, dashboard renders.

## 13. Tech Stack & Project Structure

**Stack:** Next.js (App Router) + TypeScript + React on Vercel; Supabase (Postgres/Auth/Storage) with SQL migrations in-repo; `@anthropic-ai/sdk` (server-side); Tailwind CSS + shadcn/ui; Recharts; PapaParse (+ encoding detection); Zod. Reads favor server components; only the Ask panel and import wizard need client interactivity. Library count kept deliberately low.

**Project structure (sketch)**
```
app/
  (dashboard)/page.tsx        transactions/page.tsx     insights/page.tsx
  import/page.tsx             settings/page.tsx          login/page.tsx
  api/{import,ask,insights,categorize}/...
lib/
  supabase/   ai/   csv/   categorize/   queries/
components/                    charts, tables, shadcn/ui
supabase/migrations/           SQL schema + seed categories
```

## 14. Open Questions / Future Enhancements

Deferred, easy to add later: multi-currency FX conversion; automatic bank sync via an aggregator; receipt/photo scanning; dedicated anomaly & subscription detection; scheduled/emailed digests; weekly (in addition to monthly) insights; budgets & goals with off-track alerts.
