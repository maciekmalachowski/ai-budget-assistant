# AI Budget Assistant — Phase 5A: Auth & App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the whole app behind a single Supabase email+password login: session-aware Supabase clients for the App Router, a middleware that redirects unauthenticated requests to `/login`, a minimal login page + sign-out, and an authenticated landing that proves the loop works end-to-end.

**Architecture:** Auth uses `@supabase/ssr` with cookie-backed clients. `lib/supabase/server.ts` builds a session-carrying client (anon key + RLS) for Server Components / Route Handlers / Server Actions; `lib/supabase/middleware.ts` refreshes the session per request and returns the current user; the root `middleware.ts` gates every non-public path. The service-role `createAdminClient()` (Phase 3) is unchanged and still used for RLS-bypassing work (imports in Phase 5B). The only purely-unit-testable piece — which paths are public — is extracted to `lib/auth/public-paths.ts` and tested with mocks; auth wiring itself is validated by an integration test against local Supabase (admin-creates a user, signs in with password) plus typecheck/lint/build.

**Tech Stack:** Next.js 15 App Router (middleware + Server Actions + React 19 `useActionState`), `@supabase/ssr`, `@supabase/supabase-js`, local Supabase Auth (GoTrue), Vitest. Auth method: **email + password** (spec §10 lists password as acceptable; chosen over magic-link to avoid SMTP infra locally and at deploy — easily swappable later).

> **Phase context:** Phase 5A of the 7-phase build (Phase 5 "API + Auth" was split into **5A: auth & app shell** and **5B: backend API**). `main` has Phases 1–4: scaffold; pure import/categorize engine; Supabase data model + dedup-aware repo + service-role admin client; and the AI orchestration layer (`lib/ai/*`, mocked-tested). Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` §10 (Auth & Security), §9 (Login screen). **5B** will add the DB repos, the pure query/stat-pack layer, DB-backed `QueryTools`, import orchestration (rules→AI→insert), and the `/api/ask` `/api/insights` `/api/import` routes — all behind the lock built here. Local Supabase must be running (`npx supabase start`, Docker) and `.env.local` must hold `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from `supabase start` output) for the integration test.

---

## Target File Structure (end of this phase)

```
package.json                              # + @supabase/ssr
lib/auth/public-paths.ts                  # pure isPublicPath() — unit tested
lib/auth/__tests__/public-paths.test.ts
lib/supabase/server.ts                    # createSupabaseServerClient() (cookie/session, anon key)
lib/supabase/middleware.ts                # updateSession(request) -> { response, user }
middleware.ts                             # root: refresh session + redirect gate
app/login/actions.ts                      # "use server": login(prev, formData), signOut()
app/login/page.tsx                        # minimal email+password form (client, useActionState)
app/page.tsx                              # MODIFY: authed landing (email + sign-out)
lib/supabase/__tests__/auth.itest.ts      # integration: create user (admin) + password sign-in
```

**Conventions:** `npm test` runs only `*.test.ts` (no key, no Docker). `npm run test:integration` runs `*.itest.ts` against local Supabase. Each task ends with a commit; append the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `.env.local` is gitignored and must NEVER be committed.

---

## Task 1: Add `@supabase/ssr`

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run: `npm install @supabase/ssr`
Expected: `@supabase/ssr` added under `dependencies` (current line is `^0.5`/`^0.6`; the `getAll`/`setAll` cookie API used below is stable across these), no `npm error`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @supabase/ssr for App Router auth"
```

---

## Task 2: Public-path matcher (pure, TDD)

**Files:**
- Test: `lib/auth/__tests__/public-paths.test.ts`
- Create: `lib/auth/public-paths.ts`

- [ ] **Step 1: Write the failing test**

`lib/auth/__tests__/public-paths.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isPublicPath } from "@/lib/auth/public-paths";

describe("isPublicPath", () => {
  it("treats the login page and its subpaths as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/")).toBe(true);
    expect(isPublicPath("/login/reset")).toBe(true);
  });

  it("treats the /auth namespace as public (reserved for future flows)", () => {
    expect(isPublicPath("/auth")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
  });

  it("gates everything else", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/transactions")).toBe(false);
    expect(isPublicPath("/api/ask")).toBe(false);
    expect(isPublicPath("/loginsomething")).toBe(false); // not a prefix boundary
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/auth/__tests__/public-paths.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/public-paths`.

- [ ] **Step 3: Create `lib/auth/public-paths.ts`**

```ts
/**
 * Paths reachable WITHOUT an authenticated session. Everything else is gated by
 * the middleware (redirected to /login). Kept pure so it is unit-testable apart
 * from the Next.js middleware runtime. Static assets are excluded by the
 * middleware `matcher`, not here.
 *
 * `/auth` is reserved (and kept public) for future email-confirm / password-reset
 * / magic-link callback flows even though no such route exists yet.
 */
const PUBLIC_PREFIXES = ["/login", "/auth"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/auth/__tests__/public-paths.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/public-paths.ts lib/auth/__tests__/public-paths.test.ts
git commit -m "feat(auth): pure public-path matcher for the middleware gate"
```

---

## Task 3: Session-aware Supabase server client

**Files:**
- Create: `lib/supabase/server.ts`

- [ ] **Step 1: Create `lib/supabase/server.ts`**

```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 * Backed by the request's cookies, so it carries the authenticated session and
 * operates under RLS using the anon key. For RLS-bypassing admin work (imports),
 * use createAdminClient() from "@/lib/supabase/admin" instead.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment",
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where the cookie store is read-only.
          // Safe to ignore: token refresh is handled by the middleware.
        }
      },
    },
  });
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/server.ts
git commit -m "feat(auth): cookie-backed Supabase server client"
```

---

## Task 4: Middleware session helper

**Files:**
- Create: `lib/supabase/middleware.ts`

- [ ] **Step 1: Create `lib/supabase/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Refresh the Supabase session for an incoming request and return the (possibly
 * cookie-updated) response together with the current user. MUST run in the
 * middleware so refreshed auth tokens are written back to the browser. The
 * returned `response` must be the one the middleware ultimately returns (after
 * any redirect decision) or cookies will be dropped.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: { id: string; email?: string } | null }> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment",
    );
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() revalidates the token with the auth server (getSession() does not).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user: user ? { id: user.id, email: user.email } : null };
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/middleware.ts
git commit -m "feat(auth): per-request session refresh helper"
```

---

## Task 5: Root middleware (gate + redirect)

**Files:**
- Create: `middleware.ts` (repo root)

- [ ] **Step 1: Create `middleware.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isPublicPath } from "@/lib/auth/public-paths";

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Unauthenticated + gated path → send to /login.
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user landing on /login → bounce to the app.
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run auth on every request EXCEPT Next internals and static asset files,
     * so the session is refreshed on pages and route handlers but not on assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): middleware gate redirecting unauthenticated requests to /login"
```

---

## Task 6: Login + sign-out server actions

**Files:**
- Create: `app/login/actions.ts`

- [ ] **Step 1: Create `app/login/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface LoginState {
  error: string | null;
}

/**
 * Server Action for the login form (used with React's useActionState).
 * On success the Supabase session cookies are written via the server client and
 * we redirect to the app; on failure we return the error message for display.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "Invalid email or password." };
  }

  // redirect() throws NEXT_REDIRECT (control flow) — must not be wrapped in try/catch.
  redirect("/");
}

/** Sign out and return to the login page. */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/login/actions.ts
git commit -m "feat(auth): login and sign-out server actions"
```

---

## Task 7: Login page

**Files:**
- Create: `app/login/page.tsx`

- [ ] **Step 1: Create `app/login/page.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/login/actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <form
        action={formAction}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border p-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-muted-foreground text-sm">AI Budget Assistant</p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-md border px-3 py-2"
          />
        </label>

        {state.error ? (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat(auth): minimal email+password login page"
```

---

## Task 8: Authenticated landing

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">AI Budget Assistant</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {user?.email ?? "unknown"}.
      </p>
      <form action={signOut}>
        <button type="submit" className="rounded-md border px-3 py-2 text-sm">
          Sign out
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(auth): authenticated landing with sign-out"
```

---

## Task 9: Auth integration test (local Supabase)

**Files:**
- Create: `lib/supabase/__tests__/auth.itest.ts`

This validates that local Supabase Auth works with our setup and documents how the single owner account is provisioned (admin-created, since public sign-up is disabled in production). It runs in the integration tier (Docker + `.env.local`), not the unit suite.

- [ ] **Step 1: Create `lib/supabase/__tests__/auth.itest.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

const TEST_EMAIL = "phase5a.auth.test@example.com";
const TEST_PASSWORD = "test-password-123";

describe("supabase auth (local)", () => {
  const admin = createAdminClient();
  let userId: string | undefined;

  beforeAll(async () => {
    // Owner accounts are provisioned by an admin (service role), not via public
    // sign-up. email_confirm:true makes the account immediately usable.
    const { data, error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    userId = data.user?.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("signs in an existing user with email + password", async () => {
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(error).toBeNull();
    expect(data.session?.access_token).toBeTruthy();
    expect(data.user?.email).toBe(TEST_EMAIL);
  });

  it("rejects a wrong password", async () => {
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: "definitely-wrong",
    });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npm run test:integration`
Expected: PASS — the two new auth assertions plus the existing Phase 3 `transactions.itest.ts` all green. (Requires local Supabase running and `.env.local` populated.)

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/__tests__/auth.itest.ts
git commit -m "test(auth): integration test for local email+password sign-in"
```

---

## Task 10: Full verification

- [ ] **Step 1: Unit suite (no key, no Docker)** — `npm test`
Expected: all prior unit tests + the new `public-paths` test pass (64 total, 13 files); NO `*.itest.ts` / `*.smoke.ts` collected.

- [ ] **Step 2: Integration tier** — `npm run test:integration`
Expected: 0 failures (auth + transactions itests). Requires Docker + `.env.local`.

- [ ] **Step 3: typecheck / lint / build**

```bash
npm run typecheck   # exit 0
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"; middleware compiled; "/" now ƒ (Dynamic)
```

Note: `/` becomes a dynamic route (it reads cookies via `getUser()`), and a `ƒ Middleware` line appears in the build output — both expected.

- [ ] **Step 4: Commit anything outstanding (if not clean)**

```bash
git add -A -- ':!.env.local'
git commit -m "chore: phase 5a verification" || echo "nothing to commit"
```

---

## Done when

- `npm test` passes (incl. the new `isPublicPath` unit test) and collects no `*.itest.ts`/`*.smoke.ts`.
- `npm run test:integration` passes against local Supabase (admin-created user signs in with password; wrong password rejected).
- `npm run typecheck`, `npm run lint`, `npm run build` all pass; the build shows a compiled middleware and a dynamic `/`.
- Behaviour: visiting any gated path while signed out redirects to `/login`; signing in with valid credentials lands on `/` showing the email; "Sign out" returns to `/login`; a signed-in user hitting `/login` is bounced to `/`.

**Manual smoke (optional, not automated here — Playwright e2e is deferred):** with local Supabase running, create a user once via Supabase Studio (http://localhost:54323 → Authentication → Add user, set a password, confirm) or `admin.auth.admin.createUser`, then `npm run dev` and verify the redirect/login/sign-out loop in the browser.

**Production note (Phase 7):** disable public sign-up on the cloud project (`[auth] enable_signup = false` / dashboard) so only the pre-created owner account exists; set the cloud `site_url`/redirect URLs. Local keeps sign-up enabled for convenience.

**Next:** Phase 5B — Backend API: DB repos (accounts, categories, merchant_map, import_batches, import_profiles, insights, qa_history) + transaction query/update extensions; the pure query/stat-pack layer (period parsing, aggregators, `InsightStatPack` builder); DB-backed `QueryTools` (`createQueryTools(db)`); import orchestration wiring the Phase 2 pipeline → Phase 3 repo → Phase 4 AI categorization fallback; and the `/api/ask`, `/api/insights`, `/api/import` route handlers — all behind the auth lock built in 5A.
