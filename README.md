# AI Budget Assistant

Personal, single-user spending tracker: import bank-statement CSVs, auto-categorize
transactions, ask plain-language questions, and get cached monthly/weekly insights.
Built with Next.js, Supabase, and Claude.

> Design spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md`
> Build plans: `docs/superpowers/plans/`

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values as later phases require them
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run unit tests (Vitest) |
