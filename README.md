# AI Budget Assistant

A personal, single-user spending tracker. Import your bank-statement CSVs, let it
auto-categorize transactions, ask plain-language questions about your money, and get
cached monthly/weekly insights — all running on your own Supabase project and your own
Anthropic API key.

Built with **Next.js 15** (App Router), **Supabase** (Postgres + Auth + Storage), and
**Claude** (`@anthropic-ai/sdk`).

---

## Features

- **Smart CSV import.** Drag in a bank-statement CSV and map it in an editable preview
  grid. Parsing is *headerless and position-based*, so files with no column-name header
  work, and a leading account-info/opening-balance line is auto-detected and skipped. The
  importer guesses each column's role (date, description, amount…), the decimal separator,
  the date format, and where transactions start — you confirm or correct, then import. Your
  bank's column layout is remembered for next time.
- **Rules-first categorization.** Known merchants are categorized instantly from a
  merchant map; only unknown merchants are sent to Claude (Haiku) in a single batched call,
  with confident suggestions applied automatically. AI failures degrade gracefully — rows
  just stay uncategorized and the import still completes.
- **Ask your data.** A plain-language Q&A panel answers questions about your spending. It
  uses **tool-calling over read-only query functions** (Claude calls typed query tools — it
  never writes raw SQL), executed through a SELECT-only database role.
- **Insights.** On-demand monthly/weekly summaries over a period picker.
- **Transactions & settings.** Browse/filter transactions; manage accounts, categories,
  and saved bank layouts.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript (strict) |
| Styling | Tailwind CSS v4, shadcn-style components, dark theme |
| Data | Supabase — Postgres, Auth, Storage |
| AI | Claude via `@anthropic-ai/sdk` (server-only), with prompt caching |
| Parsing | Papaparse + `iconv-lite` (UTF-8 / Windows-1250) |
| Validation | Zod |
| Tests | Vitest + Testing Library |

## Conventions

A few decisions worth knowing before you read the code:

- **Money is stored as signed integer minor units** (`amount_minor bigint`, e.g. grosze /
  cents) — never floats. Negative = outflow, positive = inflow.
- **Pure domain logic is I/O-free.** `lib/{domain,csv,categorize,import}` contain pure
  functions (parsing, money/date handling, dedup, mapping, categorization rules) with no
  database or network access; Supabase access lives in `lib/repos` and `lib/supabase`.
- **Single user, no `user_id` columns.** Row-Level Security is "authenticated → full
  access". The Q&A read path uses a dedicated **SELECT-only `readonly_qa` role** minted via
  a short-lived JWT, so the AmA feature can never mutate data.
- **Two AI tiers:** Haiku for bulk categorization, Sonnet for Q&A and insights.
- `@/*` is aliased to the repository root.

## Project layout

```
app/
  (app)/            Authenticated app shell
    page.tsx        Dashboard
    transactions/   Transaction list + filters
    insights/       Period insights
    import/         CSV import wizard
    settings/       Accounts, categories, saved layouts, AI config
  login/            Supabase Auth sign-in
  api/
    import/         Commit a CSV import
    import/preview/ Read-only parse + auto-detect preview (no writes)
    insights/       On-demand insights
    ask/            Q&A (tool-calling over read-only queries)
components/         UI (import wizard/dropzone/preview grid, dashboard, ask, settings…)
lib/
  domain/           Pure types + money/date/normalize helpers
  csv/              Parsing, headerless matrix, column-role mapping, layout detection
  categorize/       Rules-first categorization
  import/           Import pipeline (map → dedup → categorize → insert)
  ai/               Claude client, models, categorize/insights prompts
  queries/          Typed read-only query tools for Q&A
  insights/ dashboard/  Aggregation services
  repos/            Supabase data access
  supabase/         Client factories (server, admin, readonly_qa), middleware
supabase/
  migrations/       Schema, RLS, seed categories, readonly_qa role
docs/superpowers/   Design specs and per-phase implementation plans
```

---

## Getting started

### Prerequisites

- **Node.js 20+** and npm
- **Docker** (for the local Supabase stack) and the **Supabase CLI** (bundled as a dev
  dependency — use `npx supabase …`, or install globally)
- An **Anthropic API key** (`console.anthropic.com`) for the AI features

### 1. Install

```bash
npm install
```

### 2. Start Supabase locally

```bash
npx supabase start        # boots Postgres/Auth/Storage in Docker, applies migrations
npx supabase db reset     # re-applies migrations + seeds default categories (optional, clean slate)
```

`supabase start` prints your local **API URL**, **anon key**, **service-role key**, and
**JWT secret** — you'll paste these into `.env.local`. Local Studio (for creating your
sign-in user and browsing data) is at `http://localhost:54323`.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in the values (see [Environment variables](#environment-variables)). For local dev,
use the keys from `supabase start`; the JWT secret has a known local default documented in
`.env.example`.

### 4. Create your user

This is a single-user app — create one Auth user (local Studio → **Authentication → Add
user**, or your cloud project's dashboard) and sign in with it on the `/login` page.

### 5. Run

```bash
npm run dev               # http://localhost:3000
```

---

## Environment variables

All secrets are **server-only** unless prefixed `NEXT_PUBLIC_`. Never commit `.env.local`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project / local API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon key (browser auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role; bypasses RLS for the import pipeline. **Server-only.** |
| `SUPABASE_JWT_SECRET` | ✅ | Project JWT secret; mints the SELECT-only `readonly_qa` token for Q&A. **Server-only.** |
| `ANTHROPIC_API_KEY` | ✅ (AI) | Claude API key. **Server-only.** |
| `ANTHROPIC_MODEL_CATEGORIZE` | – | Categorization model (default `claude-haiku-4-5`) |
| `ANTHROPIC_MODEL_QA` | – | Q&A model (default `claude-sonnet-4-6`) |
| `ANTHROPIC_MODEL_INSIGHTS` | – | Insights model (default `claude-sonnet-4-6`) |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | – | Primary reporting currency, ISO 4217 (default `PLN`) |

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server (`http://localhost:3000`) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Fast unit tests (Vitest) — pure logic, no credentials needed |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:integration` | Integration tests (`*.itest.ts`) — need local Supabase + `.env.local` |
| `npm run test:smoke` | Smoke tests (e.g. live AI calls) — need real API keys |

## Testing

Tests are split by what they require:

- **Unit** (`*.test.ts`, run by `npm test`) — pure functions only. Fast and
  credential-free; this is the suite that gates every change.
- **Integration** (`*.itest.ts`, `npm run test:integration`) — exercise the database and
  repositories against a running local Supabase, so they need Docker and `.env.local`.
- **Smoke** (`npm run test:smoke`) — hit live external services (e.g. the Anthropic API)
  and require real keys.

---

## Deployment

Target: **Vercel** + a **cloud Supabase** project. In short:

1. Create a cloud Supabase project and link it: `npx supabase link --project-ref <ref>`.
2. Push the schema: `npx supabase db push` (applies the same `supabase/migrations`).
3. Deploy to Vercel and set the environment variables above in the project settings
   (use the cloud project's URL/keys/JWT secret and your `ANTHROPIC_API_KEY`).

A full step-by-step runbook (including the `readonly_qa` role and import upload limits)
lives at [`docs/superpowers/plans/2026-06-02-phase-7-deploy.md`](docs/superpowers/plans/2026-06-02-phase-7-deploy.md).

---

## Documentation

- **Design spec:** [`docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md`](docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md)
- **CSV import redesign:** [`docs/superpowers/specs/2026-06-03-csv-import-redesign-design.md`](docs/superpowers/specs/2026-06-03-csv-import-redesign-design.md)
- **Implementation plans (per phase):** [`docs/superpowers/plans/`](docs/superpowers/plans/)

## License

Personal project — all rights reserved. Not licensed for redistribution.
