# AI Budget Assistant — Phase 3: Data Model & Local Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the domain in Postgres via Supabase — versioned migrations for the 8 tables (+ indexes and the per-account dedup unique constraint), single-user RLS, and seeded default categories — generate typed DB types, and a dedup-aware repository that inserts Phase 2 `TransactionDraft`s while skipping rows already present for an account, verified by integration tests against a **local** Supabase.

**Architecture:** The Supabase CLI (a devDependency, run via `npx supabase`) manages a local Postgres in Docker. Schema lives in SQL migrations under `supabase/migrations/`. A service-role client (`lib/supabase/admin.ts`) is used server-side and by integration tests (service role bypasses RLS). The transactions repository turns drafts into rows, de-duplicating against existing `dedup_hash`es per account. **Unit tests stay pure/credential-free** (`*.test.ts`, run by `npm test`); **DB-backed tests are separate** (`*.itest.ts`, run by `npm run test:integration` against the local stack) so the fast suite never needs Docker.

**Tech Stack:** `supabase` CLI (devDep), `@supabase/supabase-js`, `dotenv` (load local creds for integration tests), Vitest (node env for itests). Amounts stored as `bigint` minor units — consistent with Phase 2's `amountMinor` (this refines the spec's "numeric": minor-unit integers avoid float drift).

> **Prerequisite:** Docker Desktop must be running (confirmed). `npx supabase start` boots local Postgres/Auth/Storage in Docker.
> **Phase context:** Phase 3 of 7. `main` has Phases 1–2 (scaffold + pure import/categorize engine producing `TransactionDraft[]`). Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` §6 (data model), §10 (RLS/single-user). This phase persists drafts and dedups against existing rows; AI fallback (Phase 4), API/Auth wiring (Phase 5), and UI (Phase 6) come later.

---

## Target File Structure (end of this phase)

```
supabase/config.toml                              # npx supabase init
supabase/migrations/<ts>_init_schema.sql          # 8 tables + indexes + dedup unique
supabase/migrations/<ts>_rls.sql                  # enable RLS + single-user policies
supabase/migrations/<ts>_seed_categories.sql      # default categories (is_system)
lib/supabase/database.types.ts                    # generated from the local DB
lib/supabase/admin.ts                             # service-role client factory (server/tests)
lib/repos/transactions.ts                         # insertDrafts (dedup-aware), getExistingHashes
lib/repos/__tests__/transactions.itest.ts         # integration tests vs local DB
vitest.integration.config.ts                      # node env, includes *.itest.ts, loads .env.local
vitest.integration.setup.ts                       # dotenv loader for .env.local
.env.local                                        # NOT committed; local Supabase URL + service key
```

**Conventions:** Migrations are created with `npx supabase migration new <name>` (generates a timestamped file) and applied/verified with `npx supabase db reset` (recreates the DB and runs all migrations + seed; a non-zero exit means a migration is broken). `npm test` runs only `*.test.ts` (pure, no Docker). `npm run test:integration` runs `*.itest.ts` against the running local stack. Each task ends with a commit; append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 1: Install the Supabase CLI + dotenv, and init

**Files:**
- Modify: `package.json` (via npm)
- Create: `supabase/config.toml` (+ supabase dir) via CLI

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
npm install -D supabase dotenv
```
Expected: completes; `supabase` and `dotenv` under `devDependencies`. (`supabase` is an installer package; its postinstall downloads the platform binary.)

- [ ] **Step 2: Initialize Supabase**

Run (accept defaults; decline the editor-settings prompts):
```bash
printf 'n\nn\n' | npx supabase init
```
Expected: creates `supabase/config.toml` and the `supabase/` directory. If it reports "Project already initialized", that's fine.

- [ ] **Step 3: Pin the project id (so it's deterministic, not the worktree dir name)**

Edit `supabase/config.toml` so the first key is exactly:
```toml
project_id = "ai-budget-assistant"
```
(`supabase init` defaults `project_id` to the current directory's name — which would be the worktree's name and then get committed to `main`. Force it to `ai-budget-assistant`.)

- [ ] **Step 4: Verify**

Run: `grep -q 'project_id = "ai-budget-assistant"' supabase/config.toml && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json supabase/config.toml
git commit -m "build: add Supabase CLI + dotenv; init local Supabase project"
```

---

## Task 2: Schema migration (8 tables)

**Files:**
- Create: `supabase/migrations/<ts>_init_schema.sql`

- [ ] **Step 1: Generate the migration file**

Run: `npx supabase migration new init_schema`
Expected: creates `supabase/migrations/<timestamp>_init_schema.sql` (empty). Note the generated path.

- [ ] **Step 2: Replace the generated file's contents with this schema**

```sql
-- 8-table schema for AI Budget Assistant (single-user).
-- Amounts are stored as signed minor units (bigint): negative = outflow, positive = inflow.

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'PLN',
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('expense','income','transfer')),
  color text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table import_profiles (
  id uuid primary key default gen_random_uuid(),
  header_signature text not null unique,
  column_mapping jsonb not null,
  date_format text,
  delimiter text,
  decimal_sep text,
  encoding text,
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  file_name text,
  storage_path text,
  column_mapping jsonb,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending','mapped','imported','failed')),
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  booked_at date not null,
  amount_minor bigint not null,
  currency text not null,
  raw_description text not null,
  merchant text,
  category_id uuid references categories(id) on delete set null,
  category_source text not null default 'uncategorized'
    check (category_source in ('rule','ai','user','uncategorized')),
  ai_confidence real,
  import_batch_id uuid references import_batches(id) on delete set null,
  dedup_hash text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, dedup_hash)
);

create table merchant_map (
  id uuid primary key default gen_random_uuid(),
  match_type text not null check (match_type in ('exact','contains','regex')),
  pattern text not null,
  category_id uuid not null references categories(id) on delete cascade,
  source text not null check (source in ('user','ai','seed')),
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('month','week')),
  period_start date not null,
  summary_md text,
  stats jsonb,
  stale boolean not null default false,
  generated_at timestamptz not null default now()
);

create table qa_history (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer_md text,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

create index idx_transactions_account_date on transactions (account_id, booked_at desc);
create index idx_transactions_category on transactions (category_id);
create index idx_merchant_map_category on merchant_map (category_id);
create index idx_insights_period on insights (period_type, period_start desc);
```

- [ ] **Step 3: Boot the local stack (applies migrations) and verify it succeeds**

Run: `npx supabase start`
Expected: pulls/starts containers and finishes printing a status block (API URL `http://127.0.0.1:54321`, DB on `54322`, `anon key`, `service_role key`). First run may take 1–2 minutes. A clean start means the migration applied without error.

- [ ] **Step 4: Re-apply from scratch to confirm the migration is deterministic**

Run: `npx supabase db reset`
Expected: "Resetting local database..." → "Applying migration <ts>_init_schema.sql..." → finishes with exit 0 (no SQL errors).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): initial schema — 8 tables, indexes, per-account dedup unique"
```

---

## Task 3: Row-Level Security (single-user)

**Files:**
- Create: `supabase/migrations/<ts>_rls.sql`

- [ ] **Step 1: Generate the migration**

Run: `npx supabase migration new rls`

- [ ] **Step 2: Replace the generated file's contents with**

```sql
-- Single-user app: any authenticated user has full access. Service role bypasses RLS.
alter table accounts enable row level security;
alter table categories enable row level security;
alter table import_profiles enable row level security;
alter table import_batches enable row level security;
alter table transactions enable row level security;
alter table merchant_map enable row level security;
alter table insights enable row level security;
alter table qa_history enable row level security;

create policy "authenticated_all" on accounts        for all to authenticated using (true) with check (true);
create policy "authenticated_all" on categories       for all to authenticated using (true) with check (true);
create policy "authenticated_all" on import_profiles  for all to authenticated using (true) with check (true);
create policy "authenticated_all" on import_batches   for all to authenticated using (true) with check (true);
create policy "authenticated_all" on transactions     for all to authenticated using (true) with check (true);
create policy "authenticated_all" on merchant_map     for all to authenticated using (true) with check (true);
create policy "authenticated_all" on insights         for all to authenticated using (true) with check (true);
create policy "authenticated_all" on qa_history       for all to authenticated using (true) with check (true);
```

- [ ] **Step 3: Apply & verify**

Run: `npx supabase db reset`
Expected: applies both migrations, exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): enable RLS with single-user authenticated policies"
```

---

## Task 4: Seed default categories

**Files:**
- Create: `supabase/migrations/<ts>_seed_categories.sql`

- [ ] **Step 1: Generate the migration**

Run: `npx supabase migration new seed_categories`

- [ ] **Step 2: Replace the generated file's contents with**

```sql
insert into categories (name, kind, color, is_system) values
  ('Groceries',     'expense',  '#34c759', true),
  ('Dining',        'expense',  '#ff9f0a', true),
  ('Transport',     'expense',  '#0a84ff', true),
  ('Utilities',     'expense',  '#5e5ce6', true),
  ('Housing',       'expense',  '#bf5af2', true),
  ('Health',        'expense',  '#ff375f', true),
  ('Entertainment', 'expense',  '#ff9500', true),
  ('Shopping',      'expense',  '#64d2ff', true),
  ('Subscriptions', 'expense',  '#8b5cf6', true),
  ('Income',        'income',   '#30d158', true),
  ('Transfer',      'transfer', '#8e8e93', true),
  ('Other',         'expense',  '#98989d', true);
```

- [ ] **Step 3: Apply & verify**

Run: `npx supabase db reset`
Expected: applies all three migrations, exit 0. (Category existence is asserted by the integration test in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): seed default system categories"
```

---

## Task 5: Generate typed DB types

**Files:**
- Create: `lib/supabase/database.types.ts`

- [ ] **Step 1: Generate from the running local DB**

Run: `npx supabase gen types typescript --local > lib/supabase/database.types.ts`
Expected: writes a TypeScript file exporting a `Database` type with a `public` schema containing all 8 tables.

- [ ] **Step 2: Verify it typechecks and is non-empty**

Run: `npx tsc --noEmit && grep -q "transactions" lib/supabase/database.types.ts && echo OK`
Expected: `OK` (typecheck passes and the file references the `transactions` table).

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/database.types.ts
git commit -m "feat(db): generate typed Supabase database types"
```

---

## Task 6: Service-role admin client

**Files:**
- Create: `lib/supabase/admin.ts`

- [ ] **Step 1: Create `lib/supabase/admin.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

/**
 * Server-only Supabase client using the service-role key (bypasses RLS).
 * Used by the import pipeline and integration tests. Never import this in client code.
 */
export function createAdminClient(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment",
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 2: Install the client library**

Run: `npm install @supabase/supabase-js`
Expected: added under `dependencies`.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/admin.ts package.json package-lock.json
git commit -m "feat(db): service-role admin Supabase client factory"
```

---

## Task 7: Integration-test harness (separate from the unit suite)

**Files:**
- Create: `.env.local` (NOT committed)
- Create: `vitest.integration.setup.ts`
- Create: `vitest.integration.config.ts`
- Modify: `package.json` (add `test:integration` script)

- [ ] **Step 1: Capture local Supabase credentials into `.env.local`**

Run `npx supabase status` and copy the **API URL** and **service_role key** into a new `.env.local` (gitignored already via `.env*.local`):
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<paste the service_role key from `npx supabase status`>
```
(Do NOT commit `.env.local`.)

- [ ] **Step 2: Create `vitest.integration.setup.ts`**

```ts
import { config } from "dotenv";

config({ path: ".env.local" });
```

- [ ] **Step 3: Create `vitest.integration.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.integration.setup.ts"],
    include: ["**/*.itest.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", ".worktrees/**"],
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Add the script to `package.json`**

In the `"scripts"` block, add:
```json
    "test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 5: Verify the integration runner starts (no itests yet → "no test files")**

Run: `npm run test:integration`
Expected: Vitest runs and reports no test files found (exit may be non-zero with "No test files found" — that is expected at this step; Task 8 adds the test). Confirm it did NOT pick up any `*.test.ts` unit files.

- [ ] **Step 6: Commit**

```bash
git add vitest.integration.config.ts vitest.integration.setup.ts package.json package-lock.json
git commit -m "test: add integration-test harness (local Supabase, node env)"
```

---

## Task 8: Transactions repository (dedup-aware insert) — TDD via integration test

**Files:**
- Test: `lib/repos/__tests__/transactions.itest.ts`
- Create: `lib/repos/transactions.ts`

- [ ] **Step 1: Write the failing integration test**

`lib/repos/__tests__/transactions.itest.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertDrafts, getExistingHashes } from "@/lib/repos/transactions";
import type { TransactionDraft } from "@/lib/domain/types";

const db = createAdminClient();
let accountId: string;

function draft(over: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    bookedAt: "2026-05-12",
    amountMinor: -8740,
    currency: "PLN",
    rawDescription: "BIEDRONKA 1234 WARSZAWA",
    merchant: "BIEDRONKA WARSZAWA",
    dedupHash: "hash-a",
    categoryId: null,
    categorySource: "uncategorized",
    ...over,
  };
}

beforeAll(async () => {
  const { data, error } = await db
    .from("accounts")
    .insert({ name: "ITEST mBank", currency: "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  accountId = data.id;
});

afterAll(async () => {
  // Cascades delete the account's transactions.
  await db.from("accounts").delete().eq("id", accountId);
});

describe("transactions repository (integration)", () => {
  it("inserts fresh drafts and reports counts", async () => {
    const res = await insertDrafts(db, accountId, null, [
      draft({ dedupHash: "h1" }),
      draft({ dedupHash: "h2", amountMinor: -2400 }),
    ]);
    expect(res).toEqual({ inserted: 2, duplicates: 0 });

    const { count } = await db
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId);
    expect(count).toBe(2);
  });

  it("skips drafts whose dedup_hash already exists for the account", async () => {
    const res = await insertDrafts(db, accountId, null, [
      draft({ dedupHash: "h1" }), // already inserted above
      draft({ dedupHash: "h3", amountMinor: -100 }), // new
    ]);
    expect(res).toEqual({ inserted: 1, duplicates: 1 });
  });

  it("getExistingHashes returns only the hashes present for the account", async () => {
    const set = await getExistingHashes(db, accountId, ["h1", "h2", "h3", "nope"]);
    expect(set.has("h1")).toBe(true);
    expect(set.has("h3")).toBe(true);
    expect(set.has("nope")).toBe(false);
  });

  it("returns zeros for an empty draft list", async () => {
    expect(await insertDrafts(db, accountId, null, [])).toEqual({ inserted: 0, duplicates: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `@/lib/repos/transactions`.

- [ ] **Step 3: Create `lib/repos/transactions.ts`**

```ts
import type { Db } from "@/lib/supabase/admin";
import type { TransactionDraft } from "@/lib/domain/types";

/** The set of dedup_hashes from `hashes` that already exist for this account. */
export async function getExistingHashes(
  db: Db,
  accountId: string,
  hashes: string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const { data, error } = await db
    .from("transactions")
    .select("dedup_hash")
    .eq("account_id", accountId)
    .in("dedup_hash", hashes);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.dedup_hash));
}

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/**
 * Insert transaction drafts for an account, skipping any whose dedup_hash already
 * exists for that account. Returns how many were inserted vs skipped as duplicates.
 */
export async function insertDrafts(
  db: Db,
  accountId: string,
  importBatchId: string | null,
  drafts: TransactionDraft[],
): Promise<InsertResult> {
  if (drafts.length === 0) return { inserted: 0, duplicates: 0 };

  const existing = await getExistingHashes(
    db,
    accountId,
    drafts.map((d) => d.dedupHash),
  );
  const fresh = drafts.filter((d) => !existing.has(d.dedupHash));
  const duplicates = drafts.length - fresh.length;
  if (fresh.length === 0) return { inserted: 0, duplicates };

  const rows = fresh.map((d) => ({
    account_id: accountId,
    booked_at: d.bookedAt,
    amount_minor: d.amountMinor,
    currency: d.currency,
    raw_description: d.rawDescription,
    merchant: d.merchant,
    category_id: d.categoryId,
    category_source: d.categorySource,
    import_batch_id: importBatchId,
    dedup_hash: d.dedupHash,
  }));

  const { error, count } = await db
    .from("transactions")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(error.message);
  return { inserted: count ?? fresh.length, duplicates };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:integration`
Expected: PASS — 4 tests green against the local DB.

- [ ] **Step 5: Commit**

```bash
git add lib/repos/transactions.ts lib/repos/__tests__/transactions.itest.ts
git commit -m "feat(repo): dedup-aware transaction draft insertion"
```

---

## Task 9: Full verification

- [ ] **Step 1: Unit suite still green (no Docker needed)**

Run: `npm test`
Expected: all Phase 1 + Phase 2 unit tests pass (50), and NO `*.itest.ts` files are collected.

- [ ] **Step 2: Integration suite green (local stack running)**

Run: `npm run test:integration`
Expected: 4 tests pass.

- [ ] **Step 3: Typecheck / lint / build**

```bash
npm run typecheck   # exit 0
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"
```

- [ ] **Step 4: Commit anything outstanding (if `git status` is not clean)**

```bash
git add -A -- ':!.env.local'
git commit -m "chore: phase 3 verification" || echo "nothing to commit"
```

---

## Done when

- `npx supabase db reset` applies all three migrations + seed with exit 0.
- `lib/supabase/database.types.ts` is generated and typechecks.
- `npm test` (unit, no Docker) passes; `npm run test:integration` (local DB) passes.
- `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- `insertDrafts` persists Phase 2 drafts and de-duplicates against existing rows per account.

**Notes for integration:** `.env.local` (local Supabase creds) is gitignored and must NOT be committed. The merged result on `main` will require `npx supabase start` + a populated `.env.local` to run `test:integration`, but `npm test`/`build` stay Docker-free.

**Next:** Phase 4 — AI integration (Anthropic client + prompt caching, AI categorization fallback for unknown merchants, tool-calling Q&A, insights), mocked in unit tests with a real-key smoke check.
