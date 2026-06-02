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
