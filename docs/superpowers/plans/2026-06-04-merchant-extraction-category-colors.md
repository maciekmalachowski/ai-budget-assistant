# Brand Merchant Extraction + Category Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract clean brand-level merchants from noisy card-payment descriptions (so categorization, AI, and learning work), backfill existing transactions, and make saved category colors actually render.

**Architecture:** A new pure `lib/domain/merchant.ts` exposes `extractMerchant(raw)` — an ordered list of extractors (precise card-payment matcher first, generic noise-stripping fallback last) followed by a `brandNormalize()` step. It replaces `normalizeMerchant` at its single call site (the import pipeline). Manual corrections learn an `exact` rule on the brand. A one-off, idempotent `backfillMerchants(db)` re-derives merchants and re-applies rules over existing rows. Category colors are threaded from the server pages into the dashboard donut and the transactions table via a tiny pure `lib/colors.ts` helper.

**Tech Stack:** TypeScript (strict), Vitest (unit `*.test.ts` + integration `*.itest.ts`), Supabase (`@supabase/supabase-js`), Next.js 15 App Router (RSC), Recharts, `tsx` (new dev dependency, for the backfill script).

**Spec:** `docs/superpowers/specs/2026-06-04-merchant-extraction-category-colors-design.md`

---

## File map

**Create**
- `lib/domain/merchant.ts` — `extractMerchant(raw)`, `brandNormalize(name)`, internal extractors.
- `lib/domain/__tests__/merchant.test.ts` — unit tests for the above.
- `lib/colors.ts` — `categoryColor()`, `swatchColor()`, `CATEGORY_PALETTE`, `NO_CATEGORY_COLOR`.
- `lib/__tests__/colors.test.ts` — unit tests for the color helpers.
- `lib/transactions/backfillMerchants.ts` — `backfillMerchants(db)` core logic.
- `lib/transactions/__tests__/backfillMerchants.itest.ts` — integration test against local Supabase.
- `scripts/backfill-merchants.ts` — thin CLI wrapper for the backfill.

**Modify**
- `lib/import/pipeline.ts` — use `extractMerchant` instead of `normalizeMerchant`.
- `lib/domain/normalize.ts` — remove `normalizeMerchant` (keep the hashing helpers).
- `lib/domain/__tests__/normalize.test.ts` — drop the `normalizeMerchant` tests.
- `lib/import/__tests__/pipeline.test.ts` — add a card-row → brand assertion.
- `lib/transactions/correct.ts` — learn an `exact` rule on the brand.
- `lib/transactions/__tests__/correct.itest.ts` — assert the rule is `exact`.
- `components/charts/category-donut.tsx` — color slices by category color.
- `app/(app)/page.tsx` — load categories, pass a `name → color` map to the donut.
- `components/transactions/transactions-table.tsx` — render a color swatch per row.
- `app/(app)/transactions/page.tsx` — pass the `name → color` map to the table.
- `package.json` — add `tsx` dev dependency + `backfill:merchants` script.

---

## Task 1: Merchant extraction module

**Files:**
- Create: `lib/domain/merchant.ts`
- Test: `lib/domain/__tests__/merchant.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/__tests__/merchant.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractMerchant, brandNormalize } from "@/lib/domain/merchant";

const CARD_ELECLERC =
  "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk";
const CARD_ALDI =
  "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK";

describe("extractMerchant — card payments", () => {
  it("extracts the brand from a card payment, dropping store# and city", () => {
    expect(extractMerchant(CARD_ELECLERC)).toBe("ELECLERC");
  });

  it("strips legal-entity suffixes and store#/city from a card payment", () => {
    expect(extractMerchant(CARD_ALDI)).toBe("ALDI");
  });

  it("is idempotent on an already-clean brand", () => {
    expect(extractMerchant(extractMerchant(CARD_ELECLERC))).toBe("ELECLERC");
    expect(extractMerchant("ALDI")).toBe("ALDI");
    expect(extractMerchant("BIEDRONKA WARSZAWA")).toBe("BIEDRONKA WARSZAWA");
  });
});

describe("extractMerchant — generic fallback (non-card lines)", () => {
  it("strips long digit runs and amount+currency, keeps the counterparty", () => {
    expect(extractMerchant("PRZELEW WYCHODZĄCY 12345678 JAN KOWALSKI 100,00 PLN")).toBe(
      "PRZELEW WYCHODZĄCY JAN KOWALSKI",
    );
  });

  it("strips masked card tokens", () => {
    expect(extractMerchant("421352******0246 ZABKA WARSZAWA")).toBe("ZABKA WARSZAWA");
  });

  it("never returns an empty string, even for a merchant-less line", () => {
    expect(extractMerchant("DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN").length).toBeGreaterThan(0);
  });
});

describe("brandNormalize", () => {
  it("uppercases and collapses whitespace", () => {
    expect(brandNormalize("  eLeclerc   gdansk ")).toBe("ELECLERC GDANSK");
  });

  it("strips a trailing store# + city", () => {
    expect(brandNormalize("ELECLERC 01 GDANSK")).toBe("ELECLERC");
  });

  it("strips a legal-entity suffix", () => {
    expect(brandNormalize("ALDI SP. Z O.O.")).toBe("ALDI");
  });

  it("falls back to the input when stripping would empty the string", () => {
    expect(brandNormalize("01 GDANSK")).toBe("01 GDANSK");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- merchant`
Expected: FAIL — `Failed to resolve import "@/lib/domain/merchant"` (module doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/domain/merchant.ts`:

```ts
/** Returns the merchant portion of a raw description, or null if the extractor doesn't apply. */
type MerchantExtractor = (raw: string) => string | null;

/** Card payment: "... PŁATNOŚĆ KARTĄ <amount> <CCY> <merchant>". Diacritic-lenient. */
const cardExtractor: MerchantExtractor = (raw) => {
  const m = raw.match(/P[ŁL]ATNO[ŚS][ĆC]\s+KART[ĄA]\s+[\d.,]+\s+[A-Za-z]{3}\s+(.+)$/u);
  return m ? m[1] : null;
};

const CARD_MASK = /\b\d+\*+\d+\b/g;
const AMOUNT_CCY = /\b\d+[.,]\d{2}\s+(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const BOILERPLATE = /\b(?:DOP|VISA|MASTERCARD|MAESTRO|P[ŁL]ATNO[ŚS][ĆC]|KART[ĄA])\b\.?/giu;
const LONE_CCY = /\b(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const LONG_DIGITS = /\b\d{4,}\b/g;

/** Fallback: strip obvious card/amount/boilerplate noise, keep whatever remains. */
const genericExtractor: MerchantExtractor = (raw) =>
  raw
    .replace(CARD_MASK, " ")
    .replace(AMOUNT_CCY, " ")
    .replace(BOILERPLATE, " ")
    .replace(LONE_CCY, " ")
    .replace(LONG_DIGITS, " ")
    .replace(/\s+/g, " ")
    .trim();

const EXTRACTORS: MerchantExtractor[] = [cardExtractor, genericExtractor];

const LEGAL_SUFFIX =
  /\bSP\.?\s*Z\s*O\.?\s*O\.?\b|\bS\.?\s*A\.?\b|\bSP\.?\s*J\.?\b|\bSP\.?\s*K\.?\b/giu;
/** A trailing "<1-3 digit store#> <CITY/word>" at the end of the name. */
const TRAILING_STORE_CITY = /\s+\d{1,3}\s+[\p{L}][\p{L}.\-]*$/u;

/** Collapse an extracted name to its brand: uppercase, drop legal suffixes + trailing store#/city. */
export function brandNormalize(name: string): string {
  const upper = name.toUpperCase().replace(/\s+/g, " ").trim();
  let s = upper.replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
  s = s.replace(TRAILING_STORE_CITY, "").trim();
  return s === "" ? upper : s;
}

/**
 * Derive a clean, brand-level merchant from a raw bank description.
 * Tries each extractor in order (precise card matcher first), then brand-normalizes
 * the first non-empty result. Never returns an empty string.
 */
export function extractMerchant(raw: string): string {
  for (const extractor of EXTRACTORS) {
    const got = extractor(raw);
    if (got != null && got.trim() !== "") return brandNormalize(got);
  }
  return brandNormalize(raw);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- merchant`
Expected: PASS — all cases in `merchant.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/merchant.ts lib/domain/__tests__/merchant.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): brand-level merchant extraction from card-payment descriptions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `extractMerchant` into the import pipeline; remove `normalizeMerchant`

**Files:**
- Modify: `lib/import/pipeline.ts:9`, `lib/import/pipeline.ts:38`
- Modify: `lib/domain/normalize.ts:3-13`
- Modify: `lib/domain/__tests__/normalize.test.ts:2-15`
- Modify: `lib/import/__tests__/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe("buildTransactionDrafts", ...)` in `lib/import/__tests__/pipeline.test.ts` (after the last existing test, before the closing `});` of the describe):

```ts
  it("extracts the brand merchant from a card-payment description", () => {
    const rows = [
      {
        "Data operacji": "31.05.2026",
        "Opis operacji": "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk",
        "Kwota": "-12,48",
      },
    ];
    const { drafts } = buildTransactionDrafts({ accountId: "acc-1", rows, mapping, rules });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].merchant).toBe("ELECLERC");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- pipeline`
Expected: FAIL — `expected 'DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN ELECLERC 01 GDANSK' to be 'ELECLERC'` (old `normalizeMerchant` still in use).

- [ ] **Step 3: Switch the pipeline to `extractMerchant`**

In `lib/import/pipeline.ts`, replace the import on line 9:

```ts
import { computeDedupHash, canonicalizeForHash } from "@/lib/domain/normalize";
import { extractMerchant } from "@/lib/domain/merchant";
```

And replace line 38:

```ts
      const merchant = extractMerchant(fields.rawDescription);
```

- [ ] **Step 4: Remove `normalizeMerchant` from `normalize.ts`**

In `lib/domain/normalize.ts`, delete the entire `normalizeMerchant` function (the JSDoc comment + function, currently lines 3–13). Leave `createHash` import, `canonicalizeForHash`, `DedupHashInput`, and `computeDedupHash` intact. The file should start like this after the edit:

```ts
import { createHash } from "node:crypto";

/** Whitespace/case-insensitive canonical form of a description, for stable hashing. */
export function canonicalizeForHash(rawDescription: string): string {
  return rawDescription.toUpperCase().replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 5: Remove the `normalizeMerchant` tests**

In `lib/domain/__tests__/normalize.test.ts`, change the import (line 2) to drop `normalizeMerchant`:

```ts
import { computeDedupHash } from "@/lib/domain/normalize";
```

Then delete the entire `describe("normalizeMerchant", ...)` block (currently lines 4–15). Keep the `describe("computeDedupHash", ...)` block.

- [ ] **Step 6: Run the affected tests to verify they pass**

Run: `npm test -- pipeline normalize`
Expected: PASS — the new card-row test passes; the existing `BIEDRONKA WARSZAWA` assertion still passes (the generic fallback strips the `1234` digit run); `computeDedupHash` tests pass.

- [ ] **Step 7: Verify no dangling references**

Run: `npm run typecheck`
Expected: PASS — no references to `normalizeMerchant` remain (TypeScript would error on a missing import otherwise).

- [ ] **Step 8: Commit**

```bash
git add lib/import/pipeline.ts lib/domain/normalize.ts lib/domain/__tests__/normalize.test.ts lib/import/__tests__/pipeline.test.ts
git commit -m "$(cat <<'EOF'
refactor(import): use extractMerchant in the pipeline; drop normalizeMerchant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Learn an `exact` rule on the brand (manual corrections)

**Files:**
- Modify: `lib/transactions/correct.ts:7-11`, `lib/transactions/correct.ts:24`
- Modify: `lib/transactions/__tests__/correct.itest.ts:34`, `lib/transactions/__tests__/correct.itest.ts:46`

- [ ] **Step 1: Update the integration test expectation (the failing test)**

In `lib/transactions/__tests__/correct.itest.ts`:

Change the test title on line 34 from `"sets the transaction to user-sourced and learns a contains rule"` to `"sets the transaction to user-sourced and learns an exact rule"`.

Change the assertion on line 46 from:

```ts
    expect(rules?.[0].match_type).toBe("contains");
```

to:

```ts
    expect(rules?.[0].match_type).toBe("exact");
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test:integration -- correct`
Expected: FAIL — `expected 'contains' to be 'exact'` (requires local Supabase running via `npx supabase start` and `.env.local`).

- [ ] **Step 3: Switch the learned rule to `exact`**

In `lib/transactions/correct.ts`, update line 24:

```ts
    await upsertUserRule(db, { pattern, matchType: "exact", categoryId });
```

And update the JSDoc on lines 7–11 so it stays accurate — change `learn a \`contains\` merchant_map rule` to `learn an \`exact\` merchant_map rule on the (now brand-level) merchant`.

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npm run test:integration -- correct`
Expected: PASS — the learned rule's `match_type` is `exact`, `source` is `user`, and the transaction is `user`-sourced with category `Transport`.

- [ ] **Step 5: Commit**

```bash
git add lib/transactions/correct.ts lib/transactions/__tests__/correct.itest.ts
git commit -m "$(cat <<'EOF'
feat(transactions): learn exact merchant rule on correction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Backfill core function

**Files:**
- Create: `lib/transactions/backfillMerchants.ts`
- Test: `lib/transactions/__tests__/backfillMerchants.itest.ts`

- [ ] **Step 1: Write the failing integration test**

Create `lib/transactions/__tests__/backfillMerchants.itest.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { backfillMerchants } from "@/lib/transactions/backfillMerchants";
import { getCategoryNameToId } from "@/lib/repos/categories";
import { insertDrafts, listTransactions } from "@/lib/repos/transactions";

const db = createAdminClient();
let acctId: string;
let groceriesId: string;
const RULE_PATTERN = "ELECLERC";

const CARD_ELECLERC = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk";
const CARD_ALDI = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK";

beforeAll(async () => {
  const nameToId = await getCategoryNameToId(db);
  groceriesId = nameToId.get("Groceries")!;

  const { data, error } = await db
    .from("accounts")
    .insert({ name: "ITEST backfill acct", currency: "PLN" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  acctId = data.id;

  // An exact rule on the brand — should match the eLeclerc row after backfill.
  await db.from("merchant_map").insert({
    pattern: RULE_PATTERN,
    match_type: "exact",
    category_id: groceriesId,
    source: "user",
  });

  await insertDrafts(db, acctId, null, [
    // Uncategorized card row with the OLD noisy merchant stored.
    {
      bookedAt: "2026-05-31",
      amountMinor: -1248,
      currency: "PLN",
      rawDescription: CARD_ELECLERC,
      merchant: CARD_ELECLERC.toUpperCase(),
      dedupHash: "bf-eleclerc",
      categoryId: null,
      categorySource: "uncategorized",
    },
    // A user-corrected row — its category must be preserved, but merchant refreshed.
    {
      bookedAt: "2026-05-31",
      amountMinor: -339,
      currency: "PLN",
      rawDescription: CARD_ALDI,
      merchant: CARD_ALDI.toUpperCase(),
      dedupHash: "bf-aldi",
      categoryId: groceriesId,
      categorySource: "user",
    },
  ]);
});

afterAll(async () => {
  await db.from("accounts").delete().eq("id", acctId);
  await db.from("merchant_map").delete().eq("pattern", RULE_PATTERN);
});

describe.sequential("backfillMerchants (integration)", () => {
  it("re-derives merchants, re-rules non-user rows, and preserves user rows", async () => {
    const result = await backfillMerchants(db);
    expect(result.scanned).toBeGreaterThanOrEqual(2);

    const rows = await listTransactions(db, { accountId: acctId });
    const eleclerc = rows.find((r) => r.rawDescription === CARD_ELECLERC)!;
    const aldi = rows.find((r) => r.rawDescription === CARD_ALDI)!;

    // Uncategorized eLeclerc row: merchant cleaned + matched by the exact rule.
    expect(eleclerc.merchant).toBe("ELECLERC");
    expect(eleclerc.category).toBe("Groceries");
    expect(eleclerc.categorySource).toBe("rule");

    // User-corrected ALDI row: merchant cleaned, but category/source untouched.
    expect(aldi.merchant).toBe("ALDI");
    expect(aldi.category).toBe("Groceries");
    expect(aldi.categorySource).toBe("user");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const second = await backfillMerchants(db);
    const rows = await listTransactions(db, { accountId: acctId });
    const eleclerc = rows.find((r) => r.rawDescription === CARD_ELECLERC)!;
    expect(eleclerc.merchant).toBe("ELECLERC");
    expect(eleclerc.categorySource).toBe("rule");
    expect(second.scanned).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- backfillMerchants`
Expected: FAIL — `Failed to resolve import "@/lib/transactions/backfillMerchants"`.

- [ ] **Step 3: Write the backfill implementation**

Create `lib/transactions/backfillMerchants.ts`:

```ts
import type { Db } from "@/lib/supabase/admin";
import { extractMerchant } from "@/lib/domain/merchant";
import { loadRules } from "@/lib/repos/merchantMap";
import { categorizeByRules } from "@/lib/categorize/rules";

export interface BackfillResult {
  scanned: number;
  merchantsUpdated: number;
  recategorized: number;
}

const PAGE = 1000;

/**
 * One-off, idempotent backfill: re-derive `merchant` for every transaction using the
 * current extractor, and re-apply merchant_map rules to rows that were NOT user-corrected
 * (uncategorized / ai / rule). User-corrected rows keep their category but still get a
 * refreshed merchant string. Does not call the AI.
 */
export async function backfillMerchants(db: Db): Promise<BackfillResult> {
  const rules = await loadRules(db);
  const result: BackfillResult = { scanned: 0, merchantsUpdated: 0, recategorized: 0 };

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("transactions")
      .select("id, raw_description, merchant, category_id, category_source")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const t of rows) {
      result.scanned++;
      const merchant = extractMerchant(t.raw_description);
      const update: Record<string, unknown> = {};
      if (merchant !== t.merchant) update.merchant = merchant;

      if (t.category_source !== "user") {
        const categoryId = categorizeByRules(t.raw_description, merchant, rules);
        if (categoryId && categoryId !== t.category_id) {
          update.category_id = categoryId;
          update.category_source = "rule";
          update.ai_confidence = null;
        }
      }

      if (Object.keys(update).length > 0) {
        const { error: upErr } = await db.from("transactions").update(update).eq("id", t.id);
        if (upErr) throw new Error(upErr.message);
        if ("merchant" in update) result.merchantsUpdated++;
        if ("category_id" in update) result.recategorized++;
      }
    }

    if (rows.length < PAGE) break;
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- backfillMerchants`
Expected: PASS — both `it` blocks green (merchants cleaned, eLeclerc re-ruled to Groceries, ALDI user row preserved, second run idempotent).

- [ ] **Step 5: Commit**

```bash
git add lib/transactions/backfillMerchants.ts lib/transactions/__tests__/backfillMerchants.itest.ts
git commit -m "$(cat <<'EOF'
feat(transactions): idempotent merchant backfill (re-derive + re-rule non-user rows)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Backfill CLI script

**Files:**
- Create: `scripts/backfill-merchants.ts`
- Modify: `package.json:5-15` (scripts), `package.json:34-55` (devDependencies)

> The script builds its own Supabase client with `@supabase/supabase-js` instead of importing `@/lib/supabase/admin`, because `admin.ts` imports `server-only`, which throws outside the Next.js runtime.

- [ ] **Step 1: Add the `tsx` dev dependency**

Run: `npm install --save-dev tsx`
Expected: `tsx` appears under `devDependencies` in `package.json` and `package-lock.json` updates.

- [ ] **Step 2: Add the npm script**

In `package.json`, add to the `"scripts"` object (after the `test:smoke` line):

```json
    "test:smoke": "vitest run --config vitest.smoke.config.ts",
    "backfill:merchants": "tsx scripts/backfill-merchants.ts"
```

- [ ] **Step 3: Write the script**

Create `scripts/backfill-merchants.ts`:

```ts
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { backfillMerchants } from "@/lib/transactions/backfillMerchants";

async function main() {
  config({ path: ".env.local" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await backfillMerchants(db);
  console.log(
    `Backfill complete: scanned=${result.scanned}, merchantsUpdated=${result.merchantsUpdated}, recategorized=${result.recategorized}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Verify the script typechecks**

Run: `npm run typecheck`
Expected: PASS — no type errors in `scripts/backfill-merchants.ts`.

- [ ] **Step 5: Verify the script runs end-to-end (manual)**

With local Supabase running (`npx supabase start`) and `.env.local` populated:

Run: `npm run backfill:merchants`
Expected: prints a line like `Backfill complete: scanned=<n>, merchantsUpdated=<m>, recategorized=<k>` and exits 0. (This also confirms `tsx` resolves the `@/*` tsconfig paths.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/backfill-merchants.ts
git commit -m "$(cat <<'EOF'
feat(scripts): add backfill:merchants CLI (tsx)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Color helpers

**Files:**
- Create: `lib/colors.ts`
- Test: `lib/__tests__/colors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/colors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { categoryColor, swatchColor, CATEGORY_PALETTE, NO_CATEGORY_COLOR } from "@/lib/colors";

describe("categoryColor", () => {
  it("returns the saved color when present", () => {
    expect(categoryColor("Groceries", 0, { Groceries: "#34c759" })).toBe("#34c759");
  });

  it("falls back to a deterministic palette color by index when unset", () => {
    expect(categoryColor("Mystery", 1, {})).toBe(CATEGORY_PALETTE[1]);
    expect(categoryColor("Mystery", 0, { Mystery: null })).toBe(CATEGORY_PALETTE[0]);
  });

  it("wraps the palette by index", () => {
    const i = CATEGORY_PALETTE.length + 2;
    expect(categoryColor("X", i, {})).toBe(CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]);
  });
});

describe("swatchColor", () => {
  it("returns the saved color for a named category", () => {
    expect(swatchColor("Dining", { Dining: "#ff9f0a" })).toBe("#ff9f0a");
  });

  it("returns the no-category grey for null/unknown", () => {
    expect(swatchColor(null, {})).toBe(NO_CATEGORY_COLOR);
    expect(swatchColor("Ghost", {})).toBe(NO_CATEGORY_COLOR);
    expect(swatchColor("Ghost", { Ghost: null })).toBe(NO_CATEGORY_COLOR);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- colors`
Expected: FAIL — `Failed to resolve import "@/lib/colors"`.

- [ ] **Step 3: Write the implementation**

Create `lib/colors.ts`:

```ts
/** Fallback palette for categories that have no saved color. */
export const CATEGORY_PALETTE = [
  "#0a84ff",
  "#34c759",
  "#ff9f0a",
  "#5e5ce6",
  "#ff375f",
  "#64d2ff",
  "#bf5af2",
  "#98989d",
] as const;

/** Grey used for the uncategorized / no-color swatch. */
export const NO_CATEGORY_COLOR = "#52525b";

type ColorByName = Record<string, string | null | undefined>;

/**
 * Color for a category by name: its saved color if present, else a deterministic
 * palette color chosen by `index` (so adjacent chart slices stay distinct).
 */
export function categoryColor(
  name: string,
  index: number,
  colorByName: ColorByName,
  palette: readonly string[] = CATEGORY_PALETTE,
): string {
  const saved = colorByName[name];
  if (saved) return saved;
  return palette[index % palette.length];
}

/** Swatch color for a single row's category: saved color, else the no-category grey. */
export function swatchColor(name: string | null, colorByName: ColorByName): string {
  if (!name) return NO_CATEGORY_COLOR;
  return colorByName[name] ?? NO_CATEGORY_COLOR;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- colors`
Expected: PASS — all `categoryColor` and `swatchColor` cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/colors.ts lib/__tests__/colors.test.ts
git commit -m "$(cat <<'EOF'
feat(colors): category color helpers (saved color + palette/grey fallback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Color the dashboard donut by category

**Files:**
- Modify: `components/charts/category-donut.tsx`
- Modify: `app/(app)/page.tsx:1-13`, `app/(app)/page.tsx:33`

- [ ] **Step 1: Update the donut to use category colors**

Replace the full contents of `components/charts/category-donut.tsx` with:

```tsx
"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoneyMinor } from "@/lib/format";
import { categoryColor } from "@/lib/colors";

export function CategoryDonut({
  data,
  currency,
  colorByName = {},
}: {
  data: { category: string; spentMinor: number }[];
  currency: string;
  colorByName?: Record<string, string | null>;
}) {
  // Recharts needs positive magnitudes; spend is stored negative.
  const slices = data.map((d) => ({ name: d.category, value: Math.abs(d.spentMinor) }));

  if (slices.length === 0) {
    return <p className="text-muted-foreground flex h-64 items-center justify-center text-sm">No spending this month.</p>;
  }

  const colorFor = (name: string, i: number) => categoryColor(name, i, colorByName);

  return (
    <div className="flex flex-col gap-3">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
              {slices.map((s, i) => (
                <Cell key={s.name} fill={colorFor(s.name, i)} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => (typeof value === "number" ? formatMoneyMinor(-value, currency) : String(value))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(s.name, i) }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground">{formatMoneyMinor(-s.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Load categories and pass the color map from the dashboard page**

In `app/(app)/page.tsx`, add the import (after the existing `getDashboardData` import on line 2):

```tsx
import { listCategories } from "@/lib/repos/categories";
```

Replace the data-loading lines (currently `const data = await getDashboardData(db, { month: currentMonth() });`) with:

```tsx
  const [data, categories] = await Promise.all([
    getDashboardData(db, { month: currentMonth() }),
    listCategories(db),
  ]);
  const colorByName = Object.fromEntries(
    categories.map((c) => [c.name, c.color]),
  ) as Record<string, string | null>;
```

And update the donut usage (currently `<CategoryDonut data={data.byCategory} currency={data.currency} />`) to:

```tsx
            <CategoryDonut data={data.byCategory} currency={data.currency} colorByName={colorByName} />
```

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npm run typecheck && npm run lint`
Expected: PASS — no type or lint errors.

- [ ] **Step 4: Verify visually (manual)**

With the app running (`npm run dev`) and data imported, open the dashboard. Expected: each "Spending by category" slice and its legend dot uses the category's saved color from Settings (e.g. Groceries green `#34c759`), not the old positional palette.

- [ ] **Step 5: Commit**

```bash
git add components/charts/category-donut.tsx app/(app)/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): color donut slices by saved category color

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Color swatch in the transactions table

**Files:**
- Modify: `components/transactions/transactions-table.tsx:14-43`, `components/transactions/transactions-table.tsx:45`, `components/transactions/transactions-table.tsx:69`
- Modify: `app/(app)/transactions/page.tsx:25`, `app/(app)/transactions/page.tsx:31`

- [ ] **Step 1: Pass a `name → color` map from the transactions page**

In `app/(app)/transactions/page.tsx`, after the existing `const categoryNames = categories.map((c) => c.name);` line, add:

```tsx
  const categoryColors = Object.fromEntries(
    categories.map((c) => [c.name, c.color]),
  ) as Record<string, string | null>;
```

Update the table usage (currently `<TransactionsTable rows={rows} categories={categoryNames} />`) to:

```tsx
      <TransactionsTable rows={rows} categories={categoryNames} categoryColors={categoryColors} />
```

- [ ] **Step 2: Render the swatch in the table**

In `components/transactions/transactions-table.tsx`:

Add the import near the top (after the `AI_CONFIDENCE_THRESHOLD` import):

```tsx
import { swatchColor } from "@/lib/colors";
```

Replace the `CategoryCell` component (currently lines 14–43) with this version that accepts `categoryColors` and renders a swatch:

```tsx
function CategoryCell({
  row,
  categories,
  categoryColors,
}: {
  row: TxnListItem;
  categories: string[];
  categoryColors: Record<string, string | null>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <span
        className="size-3 shrink-0 rounded-sm"
        style={{ backgroundColor: swatchColor(row.category, categoryColors) }}
        aria-hidden
      />
      <Select
        defaultValue={row.category ?? ""}
        disabled={pending}
        onChange={(e) => {
          const categoryName = e.target.value;
          if (!categoryName) return;
          setError(null);
          start(async () => {
            const res = await correctCategory({ transactionId: row.id, merchant: row.merchant, categoryName });
            if (!res.ok) setError(res.error ?? "Failed");
          });
        }}
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
```

Update the `TransactionsTable` signature (currently line 45) to accept and thread the colors:

```tsx
export function TransactionsTable({
  rows,
  categories,
  categoryColors,
}: {
  rows: TxnListItem[];
  categories: string[];
  categoryColors: Record<string, string | null>;
}) {
```

And update the `CategoryCell` usage inside the table body (currently `<CategoryCell row={t} categories={categories} />`) to:

```tsx
                <CategoryCell row={t} categories={categories} categoryColors={categoryColors} />
```

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npm run typecheck && npm run lint`
Expected: PASS — no type or lint errors.

- [ ] **Step 4: Verify visually (manual)**

With the app running, open Transactions. Expected: each row shows a small color dot matching the category's saved color; uncategorized rows show a neutral grey dot (`#52525b`).

- [ ] **Step 5: Commit**

```bash
git add components/transactions/transactions-table.tsx app/(app)/transactions/page.tsx
git commit -m "$(cat <<'EOF'
feat(transactions): show category color swatch per row

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification

**Files:** none (verification only).

- [ ] **Step 1: No dangling `normalizeMerchant` references**

Run: `git grep -n "normalizeMerchant" -- "*.ts" "*.tsx"`
Expected: no output (the symbol is fully removed).

- [ ] **Step 2: Full unit suite**

Run: `npm test`
Expected: PASS — all `*.test.ts` green (merchant, colors, pipeline, normalize, and the rest).

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS — clean.

- [ ] **Step 4: Integration suite**

Run: `npm run test:integration`
Expected: PASS — including `correct` (exact rule) and `backfillMerchants` (re-derive/re-rule/preserve + idempotent). Requires local Supabase + `.env.local`.

- [ ] **Step 5: Run the backfill once against local data (manual)**

Run: `npm run backfill:merchants`
Expected: prints the `Backfill complete: …` summary; afterwards the Transactions list shows clean brand merchants and the dashboard donut/table reflect category colors.

---

## Self-review notes

- **Spec coverage:** merchant module (Task 1) + wiring (Task 2) → goals 1–2; exact-rule learning (Task 3) → goal 3; backfill core + script (Tasks 4–5) → goal 4; donut + table colors (Tasks 6–8) → goal 5. All spec sections map to a task.
- **No placeholders:** every code/edit step shows the actual code; every run step has an expected result.
- **Type/name consistency:** `extractMerchant`/`brandNormalize`, `backfillMerchants`/`BackfillResult`, `categoryColor`/`swatchColor`/`CATEGORY_PALETTE`/`NO_CATEGORY_COLOR`, and the new `colorByName`/`categoryColors` props are named identically across the tasks that define and consume them.
- **Out of scope (unchanged):** precise transfer/BLIK/ATM/fee extractors, AI during backfill, recent-transactions/KPI colors, a backfill UI button.
