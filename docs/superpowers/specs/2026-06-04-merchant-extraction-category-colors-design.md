# Brand merchant extraction + category colors — design

Date: 2026-06-04
Status: Approved (pending spec review)

## Problem

Most transactions are card payments whose raw description buries the real merchant in
boilerplate, e.g.:

```
DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk
DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK
```

Two issues fall out of this:

1. **Category selection is weak.** `normalizeMerchant` (`lib/domain/normalize.ts`) only
   uppercases the whole line and drops pure 4+ digit tokens. The card number keeps its
   `*`, the amount keeps its `.`, so neither is stripped — the stored/displayed/AI-fed
   "merchant" is essentially the entire noisy line. Consequences:
   - The AI categorizer (`lib/ai/categorize.ts`) sees boilerplate instead of `eLeclerc`,
     so suggestions are weak.
   - When a row is manually corrected, the learned `merchant_map` rule's pattern is that
     whole noisy string (`applyCorrection`, `lib/transactions/correct.ts`), so it will
     basically never match another card payment (different amount/store#/city). Learning
     is effectively dead for card payments.

2. **Category colors don't work.** Colors are seeded and saved correctly, but never read
   back: the dashboard donut (`components/charts/category-donut.tsx`) paints slices from a
   hardcoded positional palette, and the transactions table shows no color at all. The
   dashboard data (`lib/dashboard/data.ts`) doesn't even carry the color.

## Decisions (from brainstorming)

- **Merchant grouping is brand-level.** `eLeclerc 01 Gdansk` and `ALDI SP. Z O.O. 06
  GDANSK` collapse to `ELECLERC` / `ALDI` — store numbers, city, and legal-entity suffixes
  are stripped. One correction then teaches every store of that brand.
- **Format scope: precise card extractor + strong generic fallback.** Implement the
  `PŁATNOŚĆ KARTĄ … <merchant>` pattern well now; route everything else through a generic
  cleanup. Precise extractors for transfers/BLIK/ATM/fees are deferred until we have real
  sample lines — adding one must be a tiny, local change.
- **Backfill existing data.** A one-off, idempotent backfill re-derives `merchant` for all
  existing transactions and re-applies rules to non-user rows.
- **Colors appear in the donut (the core fix) and as dots in the transactions table.**
  Recent-transactions, KPI, and a Settings audit are out of scope.

## Goals / success criteria

1. A card payment's stored & displayed merchant is the brand:
   `…PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk` → `ELECLERC`.
2. The AI categorizer receives the brand, not boilerplate — better suggestions, and fewer
   unique merchants per import (duplicate brands collapse to a single AI lookup, which is
   cheaper since the importer builds one AI item per unique merchant and `applyAiCategories`
   keys suggestions by merchant).
3. A manual correction learns a brand rule that matches future imports of that brand.
4. Existing transactions are cleaned up by a backfill, without overwriting manual
   corrections.
5. Saved category colors render in the dashboard donut and as dots in the transactions
   table.

## Design

### 1. Merchant extraction module — `lib/domain/merchant.ts` (pure)

`export function extractMerchant(raw: string): string`

- An **ordered list** of extractors, each `(raw: string) => string | null`. The first
  non-null result wins; a generic fallback is last and always returns a string.
  - **Card extractor (precise):** anchor on `PŁATNOŚĆ KARTĄ` and capture what follows the
    `<amount> <CCY>`, e.g. `/PŁATNOŚĆ KART[ĄA]\s+[\d.,]+\s+[A-Z]{3}\s+(.+)$/i`, yielding
    `eLeclerc 01 Gdansk`.
  - **Generic fallback:** strip card tokens (`\d{6}\*+\d{4}`, and any token containing
    `*`), amount+currency tokens, lone currency codes, boilerplate words (`DOP.`, `VISA`,
    `MASTERCARD`, `PŁATNOŚĆ`, `KARTĄ`), and long digit runs (`\d{4,}`); then collapse
    whitespace.
- A final `brandNormalize(s: string): string` step applied to whichever extractor matched:
  1. Uppercase and collapse whitespace.
  2. Strip legal-entity suffixes (`SP. Z O.O.`, `S.A.`, `SP. J.`, `SP. K.`).
  3. Strip a trailing store#+city — a final `<1–3 digits> <WORD>` — once.
  4. Trim. If the result is empty (over-stripped), return the pre-normalized input so the
     function never yields an empty string.

  Display stays uppercase, consistent with today's behavior.

- Dedup is **unchanged**: `computeDedupHash` / `canonicalizeForHash` stay in
  `lib/domain/normalize.ts` and still hash the raw description. `normalizeMerchant` is
  removed (it has a single call site).

### 2. Wiring

- `lib/import/pipeline.ts` (the single call site): `extractMerchant(fields.rawDescription)`
  replaces `normalizeMerchant`.
- AI path benefits automatically — no prompt rewrite. `applyAiCategories`
  (`lib/import/ai-apply.ts`) keys by `merchant`, so cleaner brands mean fewer unique
  merchants → fewer, cheaper, more accurate AI items.
- Learning (`applyCorrection`, `lib/transactions/correct.ts`): learned rules switch from
  `contains` to **`exact`** on the brand merchant. Deterministic brand extraction makes
  `exact` precise and avoids `contains` substring false-positives (e.g. `ALDI` matching
  `ALDIK`). Seeded/system rules are unaffected.

### 3. Backfill — `lib/transactions/backfillMerchants.ts` + thin `scripts/` wrapper

- Core logic lives in a testable function (takes the DB client); a thin
  `scripts/backfill-merchants.ts` wraps it, run via `npm run backfill:merchants` and
  needing the service-role key (like other ops paths).
- For every transaction: recompute `merchant = extractMerchant(raw_description)` and update
  it.
- Re-apply the current `merchant_map` rules (via `categorizeByRules`) to rows whose
  `category_source` is **not** `user` (i.e. uncategorized / ai / rule). On a rule match,
  set `category_id` and `category_source = 'rule'`.
- Never change a `user` row's category, but still refresh its merchant string for display.
- Does **not** call the AI (cost). Idempotent — safe to re-run.

### 4. Category colors

- **Donut** (`components/charts/category-donut.tsx`): the dashboard page passes a
  `name → color` map; each slice and legend dot fills with `colorMap.get(name)`, falling
  back to the existing palette for null colors and `Uncategorized`. The pure aggregator
  (`spendByCategory`) is unchanged; the page (`app/(app)/page.tsx`) adds one
  `listCategories` query to build the map.
- **Transactions table** (`components/transactions/transactions-table.tsx`): the page
  (`app/(app)/transactions/page.tsx`) already loads full `categories` (with color) but
  currently passes only names — pass the color too (a `name → color` map, or the richer
  category objects). Render a small color swatch before the category `<Select>`; grey when
  uncategorized.

### 5. Testing

- **Unit** — `extractMerchant` / `brandNormalize`: the two real card samples →
  `ELECLERC` / `ALDI`; generic-fallback cases (card tokens / amounts stripped); the
  never-empty guard; idempotence (`extract(extract(x))` stable on already-clean brands).
  Replace the existing `normalizeMerchant` tests in `lib/domain/__tests__/normalize.test.ts`.
- **Unit** — pipeline: a card row → `draft.merchant` is the brand. `correct`: a manual
  correction learns an `exact` rule on the brand.
- **Integration** (`*.itest.ts`): seed noisy rows → run the backfill function against local
  Supabase → assert merchants are cleaned, non-user rows are re-ruled, and **user rows'
  category is preserved**.

## Out of scope (YAGNI)

- Precise extractors for transfers / BLIK / ATM / fees — the generic fallback covers them;
  add precise ones later from real sample lines.
- Re-running the AI during backfill.
- Colors on recent-transactions, KPI cards, or a Settings color audit.
- A UI button for the backfill (the script suffices for a single-user app).
