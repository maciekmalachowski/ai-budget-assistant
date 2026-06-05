# AI Budget Assistant — Claude Code Configuration

Single-user personal-finance app: import bank CSVs, auto-categorize transactions,
show a dashboard, and answer questions about spending with an LLM.

## Stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript** (strict)
- **Supabase** (Postgres + RLS) — single-user: RLS is `using (true)`, server code uses the
  service-role **admin client**. No per-user scoping (a multi-user refactor must add it).
- **Tailwind v4** · **Chart.js** (via react-chartjs-2) · **Anthropic SDK** (categorization, insights, Q&A)
- **vitest** (jsdom) · **papaparse** (CSV)

## Architecture & conventions

**Money is signed integer minor units.** Negative = outflow, positive = inflow. Never floats.
`formatMoneyMinor(minor, currency, locale="pl-PL")` formats; the default locale is **pl-PL**
(tests that assert `$`/`en-US` must pass `locale` explicitly).

**Layering (keep these boundaries):**
- `lib/repos/*` — the *only* DB access. Functions take a `Db` (admin client), return typed DTOs.
- `lib/queries/*` — **pure** aggregators (`totals`, `spendByCategory`, `pacing`, `savingsRate`,
  `deltaPct`, …). No I/O, no DB. Heavily unit-tested. Put new stat math here.
- `lib/domain/*` — types, money/date parsing, merchant extraction, txn classification.
- `lib/import/*` — CSV pipeline: parse → `applyMapping` → `buildTransactionDrafts` → categorize → `insertDrafts`.
- `lib/dashboard/data.ts` — assembles the dashboard from repos + pure aggregators.
- `lib/ai/*` — Anthropic calls. **Must degrade gracefully** (AI/transport failure → leave
  uncategorized / return empty, never fail the import).
- `app/(app)/**` — server components + `"use server"` actions.
- `components/**` — UI. Charts live in `components/charts` and are `"use client"`.

**Server Action pattern** (mirror `correctCategory` / `deleteTransactions` / `updateNotes`):
validate input at the boundary → call a repo with `createAdminClient()` → `revalidatePath("/transactions")`
(+ `"/"` when dashboard totals change) → return `{ ok: boolean; error?: string }`. Wrap in try/catch.

**Categorization** is rules-first: `merchant_map` rules win; unknown merchants go to the AI in one
batched call; confident AI results are *learned* back into rules. Person-to-person transfers must
**not** match brand keyword rules (scope brand scans to the note/title for `transfer`/`internal`).

**Import dedup hash is built from the TITLE**, not the enriched `raw_description` — keep it stable
or re-imports duplicate. Shared helpers in `lib/domain/normalize` keep importer + enrich byte-identical.

**Migrations** live in `supabase/migrations/*.sql`. Apply locally with `npx supabase migration up`
**before** running code/tests that touch new columns (an un-migrated DB rejects the write).

**Charts (Chart.js gotcha):** Chart.js v4 is tree-shakeable — `components/charts/chart-setup.ts`
must register the **controllers** (`BarController`/`LineController`/`DoughnutController`), not just
the elements, or charts throw `"<type>" is not a registered controller` *in the browser*. SSR only
renders the `<canvas>`; component tests mock `react-chartjs-2` (jsdom has no canvas) — so chart
*logic* belongs in pure helpers (e.g. `lib/charts/trend.ts` `buildTrendModel`) that are unit-tested.

## Build & test

```bash
npm run typecheck          # tsc --noEmit
npm test                   # vitest unit suite (jsdom; mocks Supabase + react-chartjs-2)
npm run test:integration   # *.itest.ts against a LIVE local Supabase (NOT in the default suite)
npm run build              # next build (also type-checks + lints)
```

- **Gate before any commit:** `npm run build && npm test` must be green.
- `*.itest.ts` are **gated on a running local Supabase** and excluded from `npm test`. Run them
  with `test:integration` after `npx supabase` is up + migrations applied.
- Pure logic → unit test in `lib/**/__tests__`. DB behavior → `*.itest.ts`. UI → RTL `*.test.tsx`.

## How to work here

- **Plan first, and ALWAYS ask clarifying questions before building** (deepen scope, surface
  decisions). Lock decisions, then implement.
- **Verify before claiming done:** run the gate; report failures honestly with output.
- **Branch off `main`** for changes. **Commit only when asked.**
- **No `Co-Authored-By` trailer** — this project has no `attribution.commit` set (#2078). Ignore
  the Bash tool's default template suggestion.
- Don't commit secrets / `.env`. Read a file before editing it. Keep files under ~500 lines.
  Validate input at system boundaries. Don't create files (esp. docs) unless needed/requested.

## Agents & ruflo (what actually works here)

The lead (you) does the implementation in-loop. **Subagent `Edit`/`Write` is denied in this
environment**, so background "coder" agents can't modify files — don't rely on them to implement.
Use background subagents for what they *can* do well:

- **Read-only review** — `ruflo-core:reviewer` on a diff (the proven 2-stage flow: reviewer audits →
  lead applies SHOULD-FIX → re-verify → commit).
- **Research / breadth search** — `Explore`, `ruflo-core:researcher`.

Agents don't park; the lead resumes them by `agentId` / gets a completion notification. Spawn
parallel read-only agents in one message when work is independent.

**SPARC boundary:** when a `/sparc:*` command is used, follow SPARC only — do **not** trigger
Superpowers skills. Start brand-new features with brainstorming.

**ruflo MCP** (`claude-flow` server in `.mcp.json`): discover tools with `ToolSearch`. Useful:
`memory_store` / `memory_search` (patterns namespace), `hooks_route`. Coordination/memory hooks run
automatically (see `.claude/settings.json`).

**When to use multiple agents:** YES for 3+ files / cross-module review / broad research. NO for
single-file or 1–2 line fixes — just do them directly (don't spawn a swarm for a typo).

## Memory

Claude's native auto-memory (`~/.claude/projects/<proj>/memory/*.md`, Obsidian-style `[[links]]`)
is the human-readable source of truth for project facts — keep it current. ruflo's vector memory
(agentdb/ruvector) serves coordination/semantic recall.
