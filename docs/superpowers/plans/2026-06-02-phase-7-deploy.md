# Phase 7 — Deploy Hardening + Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app production-deployable: cap import uploads, add a SELECT-only Postgres role so the Q&A path physically cannot write (defense-in-depth), and ship a precise deploy runbook for the user to execute (cloud Supabase + Vercel).

**Architecture:** Two parts. **Part 1 (code, Tasks 1–6)** is built/tested/merged through the normal worktree loop. **Part 2 (Task 7)** is a committed operational runbook (`docs/DEPLOY.md`) — no code; the user runs it because it touches secrets and external dashboards. The read-only role is implemented PostgREST-style: a dedicated `readonly_qa` Postgres role with SELECT grants + permissive SELECT RLS policies, reached via a supabase-js client that sends the normal anon key as `apikey` (to pass the API gateway) and a short HS256 JWT carrying `role: "readonly_qa"` as the `Authorization` bearer (so PostgREST `SET ROLE`s into it). Reads go through this client; the only write the Q&A route makes (the audit log) keeps using the admin client.

**Tech Stack:** Next.js 15 route handlers, Supabase (Postgres roles + RLS + PostgREST role-switching), `node:crypto` (HS256 JWT, no new dep), Vitest (unit + integration), `supabase` CLI + Vercel (runbook only).

---

## Background facts (already verified — do not re-investigate)

- **Auth gating is already production-ready.** `middleware.ts` redirects unauthenticated users on gated paths to `/login` and bounces authenticated users off `/login`. No change needed. (The `redirectTo` deep-link TODO is intentionally deferred.)
- **`/api/import`** (`app/api/import/route.ts`) takes multipart form-data, reads `file` (a `File`) via `Buffer.from(await file.arrayBuffer())` with **no size cap** — the gap this phase closes. The client wizard already renders any `{ error }` JSON the route returns, so a 413 needs no client change.
- **`/api/ask`** (`app/api/ask/route.ts`) currently uses `createAdminClient()` for both the read tools and the `logQa` write. The Q&A query tools (`lib/queries/tools.ts`) read `transactions` + `categories` only.
- **Existing migrations** live in `supabase/migrations/` (`init_schema`, `rls`, `seed_categories`, `schema_hardening`). RLS is enabled with "authenticated → full access" policies. The `postgres` migration role owns objects.
- **Vercel serverless request-body limit is ~4.5 MB** on Hobby, so the import cap is set to **4 MB** (meaningful and under the platform limit).
- Money is signed integer minor units everywhere. Vitest tiers: `*.test.ts` unit (no creds), `*.itest.ts` integration (local Supabase + `.env.local`).

---

## File Structure

**New files**
- `lib/import/limits.ts` — `MAX_IMPORT_BYTES` + pure `importTooLarge(bytes)`.
- `lib/import/__tests__/limits.test.ts` — unit test for the cap.
- `supabase/migrations/20260602120000_readonly_qa_role.sql` — the `readonly_qa` role, grants, and SELECT policies.
- `lib/supabase/readonly.ts` — `createReadonlyClient()` + internal `mintReadonlyJwt()`.
- `lib/supabase/__tests__/readonly-jwt.test.ts` — unit test for the HS256 JWT minting (pure, no DB).
- `lib/supabase/__tests__/readonly.itest.ts` — integration test: readonly client can SELECT but not INSERT (local Supabase).
- `docs/DEPLOY.md` — the deploy runbook.

**Modified files**
- `app/api/import/route.ts` — reject oversize uploads with 413.
- `app/api/ask/route.ts` — read via `createReadonlyClient()`, write the audit log via `createAdminClient()`.
- `.env.example` — add `SUPABASE_JWT_SECRET`.

---

## Task 1: Import file-size cap

**Files:**
- Create: `lib/import/limits.ts`
- Create: `lib/import/__tests__/limits.test.ts`
- Modify: `app/api/import/route.ts`

- [ ] **Step 1: Write the failing test**

`lib/import/__tests__/limits.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, importTooLarge } from "@/lib/import/limits";

describe("importTooLarge", () => {
  it("is false at or below the cap", () => {
    expect(importTooLarge(0)).toBe(false);
    expect(importTooLarge(MAX_IMPORT_BYTES)).toBe(false);
  });
  it("is true above the cap", () => {
    expect(importTooLarge(MAX_IMPORT_BYTES + 1)).toBe(true);
  });
  it("caps at 4 MB", () => {
    expect(MAX_IMPORT_BYTES).toBe(4 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- limits`
Expected: FAIL — cannot resolve `@/lib/import/limits`.

- [ ] **Step 3: Implement the helper**

`lib/import/limits.ts`:
```ts
/**
 * Max accepted CSV upload size. Kept under Vercel's ~4.5 MB serverless request-body
 * limit so the cap is meaningful (a bank statement CSV is far smaller in practice).
 */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** True when an upload of `bytes` exceeds the import cap. */
export function importTooLarge(bytes: number): boolean {
  return bytes > MAX_IMPORT_BYTES;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- limits`
Expected: PASS.

- [ ] **Step 5: Guard the route**

In `app/api/import/route.ts`, add the import and the guard. Add near the top with the other imports:
```ts
import { importTooLarge, MAX_IMPORT_BYTES } from "@/lib/import/limits";
```
Then, immediately after the existing block that validates `file`/`accountId` (the `if (!(file instanceof File) ...)` check that returns 400), insert:
```ts
  if (importTooLarge(file.size)) {
    return NextResponse.json(
      { error: `File too large. Maximum ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }
```
(This runs before `Buffer.from(await file.arrayBuffer())`, so an oversize file is never read into memory.)

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/import/limits.ts lib/import/__tests__/limits.test.ts "app/api/import/route.ts"
git commit -m "feat(import): cap upload size at 4 MB (413 on oversize)"
```

---

## Task 2: `readonly_qa` Postgres role migration

**Files:**
- Create: `supabase/migrations/20260602120000_readonly_qa_role.sql`

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260602120000_readonly_qa_role.sql`:
```sql
-- Defense-in-depth for the Q&A path: a SELECT-only role used only by the
-- question-answering reads. It has no INSERT/UPDATE/DELETE grants, so even if a
-- Q&A tool were ever changed to attempt a write, the database refuses it.
--
-- PostgREST switches into this role when it receives a JWT whose `role` claim is
-- "readonly_qa" (see lib/supabase/readonly.ts). The role must therefore be
-- grantable to PostgREST's login role ("authenticator"), and — because RLS is on —
-- needs a permissive SELECT policy on each table it reads.

create role readonly_qa nologin;
grant readonly_qa to authenticator;

grant usage on schema public to readonly_qa;
grant select on all tables in schema public to readonly_qa;
-- Future tables created by the migration owner are readable too.
alter default privileges in schema public grant select on tables to readonly_qa;

-- RLS is enabled on every table with "authenticated → full access" policies.
-- readonly_qa is a distinct role, so it needs its own SELECT policies. It has no
-- write grants, so SELECT-only policies are sufficient (no write policy can be used).
create policy "readonly_qa reads accounts"        on accounts        for select to readonly_qa using (true);
create policy "readonly_qa reads categories"      on categories      for select to readonly_qa using (true);
create policy "readonly_qa reads transactions"    on transactions    for select to readonly_qa using (true);
create policy "readonly_qa reads merchant_map"    on merchant_map    for select to readonly_qa using (true);
create policy "readonly_qa reads import_profiles" on import_profiles for select to readonly_qa using (true);
create policy "readonly_qa reads import_batches"  on import_batches  for select to readonly_qa using (true);
create policy "readonly_qa reads insights"        on insights        for select to readonly_qa using (true);
create policy "readonly_qa reads qa_history"      on qa_history      for select to readonly_qa using (true);
```

- [ ] **Step 2: Apply it to local Supabase (if available)**

Run: `npx supabase db reset` (re-applies all migrations + seed) — OR `npx supabase migration up` if you prefer incremental.
Expected: completes without error; the new migration applies.
If local Supabase / Docker is NOT running, SKIP this step and note it — the SQL is validated when the integration test runs (Task 3) and during the deploy `db push` (Task 7).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260602120000_readonly_qa_role.sql
git commit -m "feat(db): SELECT-only readonly_qa role for the Q&A path"
```

---

## Task 3: `createReadonlyClient()` + JWT minting

**Files:**
- Create: `lib/supabase/readonly.ts`
- Create: `lib/supabase/__tests__/readonly-jwt.test.ts`
- Create: `lib/supabase/__tests__/readonly.itest.ts`

- [ ] **Step 1: Write the failing unit test (pure JWT minting)**

`lib/supabase/__tests__/readonly-jwt.test.ts`:
```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { __mintReadonlyJwt } from "@/lib/supabase/readonly";

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

describe("mintReadonlyJwt", () => {
  const secret = "test-secret-at-least-32-characters-long!!";

  it("produces an HS256 JWT with role=readonly_qa", () => {
    const token = __mintReadonlyJwt(secret);
    const [header, payload] = token.split(".");
    expect(decodeSegment(header)).toEqual({ alg: "HS256", typ: "JWT" });
    const claims = decodeSegment(payload);
    expect(claims.role).toBe("readonly_qa");
    expect(typeof claims.exp).toBe("number");
  });

  it("signs the header.payload with the secret (HMAC-SHA256, base64url)", () => {
    const token = __mintReadonlyJwt(secret);
    const [header, payload, sig] = token.split(".");
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    expect(sig).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- readonly-jwt`
Expected: FAIL — cannot resolve `@/lib/supabase/readonly`.

- [ ] **Step 3: Implement**

`lib/supabase/readonly.ts`:
```ts
import "server-only";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const ROLE = "readonly_qa";
const TOKEN_TTL_SECONDS = 300;

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Mint a short-lived HS256 JWT carrying `role: "readonly_qa"`, signed with the
 * project's JWT secret. PostgREST validates the signature and SET ROLEs into the
 * claimed role for the request. Exported with a `__` prefix for unit testing only.
 */
export function __mintReadonlyJwt(secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ role: ROLE, iat: nowSeconds, exp: nowSeconds + TOKEN_TTL_SECONDS }));
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * A Supabase client whose database requests run as the SELECT-only `readonly_qa`
 * role (used by the Q&A read path). The anon key is sent as `apikey` so the request
 * passes the API gateway; the minted role JWT is the `Authorization` bearer so
 * PostgREST switches roles. Server-only — never import in client code.
 */
export function createReadonlyClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!url || !anonKey || !jwtSecret) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_JWT_SECRET in the environment",
    );
  }
  const token = __mintReadonlyJwt(jwtSecret);
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Run the unit test**

Run: `npm test -- readonly-jwt`
Expected: PASS (both cases).

- [ ] **Step 5: Write the integration test**

`lib/supabase/__tests__/readonly.itest.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createReadonlyClient } from "@/lib/supabase/readonly";

// Requires local Supabase + SUPABASE_JWT_SECRET in .env.local (the local default
// secret is fine). Verifies the role can read but not write.
describe("createReadonlyClient (integration)", () => {
  it("can SELECT", async () => {
    const db = createReadonlyClient();
    const { error } = await db.from("categories").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("cannot INSERT (no write grant)", async () => {
    const db = createReadonlyClient();
    const { error } = await db.from("categories").insert({ name: "RO_SHOULD_FAIL", kind: "expense" });
    expect(error).not.toBeNull(); // permission denied for table categories
  });
});
```

- [ ] **Step 6: Run the integration test (if local Supabase is up + migration applied + SUPABASE_JWT_SECRET set)**

Run: `npm run test:integration -- readonly`
Expected: PASS. If local Supabase isn't available or `SUPABASE_JWT_SECRET` isn't in `.env.local`, SKIP and note it — the file must still compile under `npm run typecheck`.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/supabase/readonly.ts lib/supabase/__tests__/readonly-jwt.test.ts lib/supabase/__tests__/readonly.itest.ts
git commit -m "feat(supabase): readonly_qa client (role-switching JWT)"
```

---

## Task 4: Route Q&A reads through the read-only client

**Files:**
- Modify: `app/api/ask/route.ts`

- [ ] **Step 1: Wire it up**

In `app/api/ask/route.ts`, add the import:
```ts
import { createReadonlyClient } from "@/lib/supabase/readonly";
```
Then change the handler body so reads use the readonly client and only the audit-log write uses admin. Replace:
```ts
  const db = createAdminClient();
  try {
    const result = await answerQuestion(getAnthropicClient(), parsed.data.question, createQueryTools(db));
    await logQa(db, { question: parsed.data.question, answerMd: result.answer, toolCalls: result.toolCalls });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Sorry, I couldn't answer that. Please try rephrasing." }, { status: 502 });
  }
```
with:
```ts
  const readDb = createReadonlyClient();
  const writeDb = createAdminClient();
  try {
    const result = await answerQuestion(getAnthropicClient(), parsed.data.question, createQueryTools(readDb));
    await logQa(writeDb, { question: parsed.data.question, answerMd: result.answer, toolCalls: result.toolCalls });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Sorry, I couldn't answer that. Please try rephrasing." }, { status: 502 });
  }
```
(`createAdminClient` is still imported and used for `writeDb`.)

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "app/api/ask/route.ts"
git commit -m "feat(ask): run Q&A reads via the readonly_qa client"
```

---

## Task 5: Document the new env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add `SUPABASE_JWT_SECRET`**

In `.env.example`, under the Supabase section (after `SUPABASE_SERVICE_ROLE_KEY`), add:
```
# Server-only. The project JWT secret (Supabase dashboard → Settings → API → JWT Secret).
# Used to mint the SELECT-only readonly_qa token for the Q&A read path. NEVER commit.
# Local default (from `supabase start`): super-secret-jwt-token-with-at-least-32-characters-long
SUPABASE_JWT_SECRET=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): document SUPABASE_JWT_SECRET for readonly_qa"
```

---

## Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Unit suite**

Run: `npm test`
Expected: all unit tests pass (existing + the new `limits` and `readonly-jwt` tests).

- [ ] **Step 2: Integration suite (if local Supabase up + migration applied + SUPABASE_JWT_SECRET set)**

Run: `npm run test:integration`
Expected: all pass, including `readonly.itest.ts`. If local Supabase isn't available, note which itests were not run.

- [ ] **Step 3: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all clean.

---

## Task 7: Deploy runbook (`docs/DEPLOY.md`)

**Files:**
- Create: `docs/DEPLOY.md`

- [ ] **Step 1: Write the runbook**

Create `docs/DEPLOY.md` with exactly this content:

````markdown
# Deploy Runbook — AI Budget Assistant

Single-user app → **Vercel** (Next.js) + **cloud Supabase** (Postgres/Auth). Money is
integer minor units; the same in-repo migrations run locally and in the cloud.

> **Secrets rule:** the service-role key, JWT secret, and Anthropic key go **only**
> into the Vercel dashboard / your local `.env.local`. Never commit them; never paste
> them into chat or a PR.

## 0. Prerequisites
- A Supabase account + a new **cloud project** (note its region + project ref).
- A Vercel account connected to the GitHub repo `maciekmalachowski/ai-budget-assistant`.
- An Anthropic API key (https://console.anthropic.com).
- `supabase` CLI logged in: `npx supabase login`.

## 1. Push the schema to cloud Supabase
```bash
# from the repo root
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push          # applies ALL migrations incl. seed_categories + readonly_qa_role
```
Verify in the dashboard → Table editor that the 8 tables + seeded categories exist, and
→ Database → Roles that `readonly_qa` exists.

## 2. Collect the cloud secrets (dashboard → Settings → API)
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `JWT Secret` → `SUPABASE_JWT_SECRET` (server-only)

## 3. Create the single user + lock sign-ups
- Dashboard → Authentication → Users → **Add user** (your email + a strong password).
  Confirm the email if required.
- Dashboard → Authentication → **Sign In / Providers** (or Settings) → turn **off**
  "Allow new users to sign up". This is what "disable public sign-up in production" means —
  the app has no sign-up UI; this closes the API-level signup endpoint.

## 4. Configure Auth URLs
- Dashboard → Authentication → URL Configuration:
  - **Site URL** = your Vercel production URL (e.g. `https://ai-budget-assistant.vercel.app`).
  - **Redirect URLs** = add the same origin (and any preview origins you want to allow).

## 5. Set Vercel environment variables
Vercel → Project → Settings → Environment Variables (Production, and Preview if you use it).
Add each (mark the server-only ones as such; do NOT prefix them with `NEXT_PUBLIC_`):

| Variable | Value | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from §2 | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from §2 | public |
| `SUPABASE_SERVICE_ROLE_KEY` | from §2 | **server-only** |
| `SUPABASE_JWT_SECRET` | from §2 | **server-only** |
| `ANTHROPIC_API_KEY` | your key | **server-only** |
| `ANTHROPIC_MODEL_CATEGORIZE` | `claude-haiku-4-5` | server |
| `ANTHROPIC_MODEL_QA` | `claude-sonnet-4-6` | server |
| `ANTHROPIC_MODEL_INSIGHTS` | `claude-sonnet-4-6` | server |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | `PLN` | public |

## 6. Deploy
- Import the repo in Vercel (Framework preset: **Next.js**), or if already linked just
  push to `main` — Vercel auto-builds and deploys.
- The build runs `next build`. No build-time DB access is required.

## 7. Post-deploy smoke test (in the browser)
1. Visit the prod URL → you're redirected to `/login`.
2. Log in with the §3 user.
3. **Settings** → add an account.
4. **Import** → upload a small bank CSV → map columns (first time) → confirm the import summary.
5. **Transactions** → rows appear; change a category → it sticks (and a merchant rule is learned).
6. **Dashboard** → KPIs/donut/trend reflect the data.
7. **Insights** → pick the month → **Generate** → a summary + numbers render.
8. **Ask AI** (button or `/`) → ask "How much did I spend last month?" → a grounded answer.
9. Confirm an oversize (>4 MB) CSV is rejected with a clear error.

## 8. Cost guardrails
- Categorization uses Haiku; Q&A + insights use Sonnet (override via the `ANTHROPIC_MODEL_*` vars).
- Insights generate **only** when you click Generate (cached afterward); Q&A runs per question.
- Watch spend at https://console.anthropic.com → Usage.

## 9. Rollback
- Vercel → Deployments → promote a previous successful deployment.
- DB migrations are forward-only; to revert schema, write a new migration and `db push`.

## 10. Known follow-ups (not blockers)
- `npm audit` flags a **critical** in `vitest <4.1.0` — dev-only and only exploitable via the
  Vitest **UI** server (never run here). Clear it later with a deliberate `vitest@^4` bump
  (a breaking major; re-verify all three vitest configs).
- `redirectTo` deep-link after login is deferred (you land on `/` after signing in).
````

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: production deploy runbook (cloud Supabase + Vercel)"
```

---

## Out of Scope (explicitly deferred)

- **`redirectTo` deep-link** after login (middleware TODO) — deferred per the Phase 7 scope decision.
- **`vitest` 3→4 bump** for the audit finding — deferred (dev-only, UI-only); captured in the runbook §10.
- **Editable model/budget config & API-cost guard** — remains env-configured (Phase 6C decision).
- **Per-account currency in the import wizard** — single-currency default stands.

---

## Self-Review

**Scope coverage (Phase 7 goals):**
- Link cloud Supabase + `db push` migrations → runbook §1. ✅
- Deploy to Vercel → runbook §5–6. ✅
- Disable public sign-up in production → runbook §3. ✅
- Cloud site_url / redirect URLs → runbook §4. ✅
- Read-only DB role for Q&A → Tasks 2–4 (migration + client + route wiring). ✅
- File-size cap on `/api/import` → Task 1. ✅
- Audit finding (vitest) → documented as a deliberate follow-up (runbook §10), not silently dropped. ✅

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step shows complete code; the runbook is fully written, not stubbed.

**Type consistency:** `MAX_IMPORT_BYTES`/`importTooLarge` defined in Task 1 and used in the route (same task). `__mintReadonlyJwt`/`createReadonlyClient` defined in Task 3, used by its tests (Task 3) and the ask route (Task 4). `createReadonlyClient()` returns `SupabaseClient<Database>`, the same `Db`-compatible type `createQueryTools` expects (`createQueryTools(db: Db)` where `Db = SupabaseClient<Database>`). `SUPABASE_JWT_SECRET` is read in `readonly.ts` (Task 3) and documented in `.env.example` (Task 5) + the runbook (Task 7).

**Risk note for the executor:** the `readonly.itest.ts` and the migration apply step need local Supabase + `SUPABASE_JWT_SECRET` in `.env.local`; if unavailable, those steps are skipped (the files still compile/typecheck) and are validated at deploy `db push` + first prod Q&A.
