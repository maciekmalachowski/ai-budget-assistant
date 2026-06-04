# Transaction Field Extraction & Categorization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Santander CSV importer from cutting off transfer names, and categorize the bulk of transactions automatically via a seed merchant dictionary + AI fallback that learns.

**Architecture:** Each CSV row is classified by type (card / BLIK / transfer / internal / fee) from its title; the merchant/payee is then pulled from the correct column (title for card payments, the counterparty column for BLIK & transfers). The full reconstructed line is stored in `raw_description` so nothing is lost. Categorization runs seed/user/AI `merchant_map` rules first, sends only unknown merchants to Claude Haiku (with the note + amount sign), and persists confident AI guesses for real merchants as learned rules. Existing data is fixed by an idempotent backfill (categories from stored data) plus a one-time CSV-enrich step that recovers counterparty names without creating duplicates.

**Tech Stack:** TypeScript, Next.js 15 (App Router), Supabase (Postgres), Vitest, `@anthropic-ai/sdk`, tsx (CLI scripts).

---

## Key refinements over the spec (read before starting)

These are deliberate, the engineer must follow them:

1. **Dedup hash stays computed from the title (description-join), not the enriched `raw_description`.** Today `applyMapping` returns `rawDescription = join(descriptionColumns)` and the dedup hash is built from it. We now split that into `title` (the join — unchanged value) and an enriched `rawDescription` (title + counterparty + account). The dedup hash continues to be built from **`title`**, so already-imported rows keep matching and re-imports don't explode into duplicates. **Counterparty must be mapped to the new `counterparty` role, NOT added as a second `description` column** — otherwise the title changes and dedup breaks.
2. **Seed dictionary is a code module applied by an idempotent seeder, not a SQL migration.** The spec said "seed migration"; a code seeder keeps the dictionary DRY (single source of truth in `seedRules.ts`), testable, and re-runnable. It runs from the backfill script.
3. **CSV-enrich for existing transfer names.** DB-only backfill cannot recover a counterparty name that was never stored (the old importer mapped only the title column). A separate `enrichFromCsv` step re-reads the CSV, matches existing rows by the (unchanged) dedup hash, and fills in the counterparty / merchant / category in place.

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/domain/types.ts` | Shared types | Modify: `TxnType`, `ColumnMapping` (+counterparty cols), `MappedFields` (+title, +counterparty), `TransactionDraft` (+txnType) |
| `lib/domain/txnType.ts` | Classify a row by title prefix | Create |
| `lib/domain/merchant.ts` | Type-aware merchant/payee extraction | Rewrite |
| `lib/csv/mapping.ts` | Row → MappedFields (title, counterparty, enriched raw) | Modify |
| `lib/csv/roles.ts` | Column-role ↔ ColumnMapping | Modify (+counterparty roles) |
| `lib/categorize/seedRules.ts` | Curated Polish merchant→category dictionary | Create |
| `lib/repos/merchantMap.ts` | Rule persistence | Modify (+seed seeder, +AI rule insert) |
| `lib/ai/categorize.ts` | Claude batch categorizer prompt | Modify (prompt only) |
| `lib/import/ai-apply.ts` | AI thresholds | Modify (+`AI_LEARN_THRESHOLD`) |
| `lib/import/pipeline.ts` | Row → drafts | Modify |
| `lib/import/run.ts` | End-to-end import + learning | Modify |
| `components/import/import-preview.tsx` | Mapping grid | Modify (+2 roles) |
| `lib/transactions/backfillMerchants.ts` | Backfill + CSV-enrich | Modify |
| `scripts/backfill-merchants.ts` | CLI | Modify |

---

## Task 1: Types + transaction-type classifier

**Files:**
- Modify: `lib/domain/types.ts`
- Create: `lib/domain/txnType.ts`
- Test: `lib/domain/__tests__/txnType.test.ts`

- [ ] **Step 1: Add types**

In `lib/domain/types.ts`, add the `TxnType` union after `CategorySource` (line 13):

```typescript
/** Coarse transaction type, inferred from the row, that drives merchant extraction. */
export type TxnType = "card" | "blik" | "transfer" | "internal" | "fee";
```

Extend `ColumnMapping` (after `currencyColumn?` line 32) with two optional columns:

```typescript
  /** Optional counterparty (payee) name column — used for transfers and BLIK. */
  counterpartyColumn?: string;
  /** Optional counterparty bank-account column. */
  counterpartyAccountColumn?: string;
```

Replace the `MappedFields` interface (lines 36-44) with:

```typescript
/** Normalized fields extracted from a single CSV row. */
export interface MappedFields {
  /** ISO date, "YYYY-MM-DD". */
  bookedAt: string;
  /** Signed integer minor units (negative = outflow, positive = inflow). */
  amountMinor: number;
  currency: string;
  /** The title/note column(s) joined — the dedup-hash basis (kept stable). */
  title: string;
  /** Counterparty (payee) name, or "" when not mapped. */
  counterparty: string;
  /** Full reconstructed line (title + counterparty + account) for display/search. */
  rawDescription: string;
}
```

Add `txnType` to `TransactionDraft` (after `merchant: string;` line 59):

```typescript
  /** Transient: drives AI-rule learning; not persisted to the DB. */
  txnType?: TxnType;
```

- [ ] **Step 2: Write the failing test**

Create `lib/domain/__tests__/txnType.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyTransaction } from "@/lib/domain/txnType";

describe("classifyTransaction", () => {
  it("classifies card payments", () => {
    expect(
      classifyTransaction("DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK", ""),
    ).toBe("card");
  });

  it("classifies card refunds as card", () => {
    expect(
      classifyTransaction("DOP. VISA 421352******0246 ZWROT PŁATNOŚCI KARTĄ 73.62 PLN Temu.com INTERNET", ""),
    ).toBe("card");
  });

  it("classifies BLIK purchases, refunds and phone transfers", () => {
    expect(classifyTransaction("Zakup BLIK Decathlon Sp. z o.o. ref:94077292755", "Decathlon Sp. z o.o.")).toBe("blik");
    expect(classifyTransaction("Zwrot BLIK PayPro S.A. ref:93601725170", "")).toBe("blik");
    expect(classifyTransaction("Przelew BLIK na telefon", "MALINOWSKI DAMIAN")).toBe("blik");
  });

  it("classifies internal own-account moves", () => {
    expect(classifyTransaction("Between your own accounts", "MACIEJ MAŁACHOWSKI UL. KROKUSOWA 9")).toBe("internal");
  });

  it("classifies bank fees / interest", () => {
    expect(classifyTransaction("UZNANIE Odsetki od salda dodatniego", "")).toBe("fee");
    expect(classifyTransaction("OBCIĄŻENIE Podatek pobrany", "")).toBe("fee");
  });

  it("classifies everything else with a counterparty as a transfer", () => {
    expect(classifyTransaction("Przelew na telefon Od: 48604263864 Do: 485*****130", "JULIA ZAKRZEWSKA")).toBe("transfer");
    expect(classifyTransaction("kwiatki dla mamy", "Szymek")).toBe("transfer");
    expect(classifyTransaction("Przelew", "TERESA KASPEROWICZ SOKOLE 43")).toBe("transfer");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/domain/__tests__/txnType.test.ts`
Expected: FAIL — `classifyTransaction` not exported / module not found.

- [ ] **Step 4: Implement the classifier**

Create `lib/domain/txnType.ts`:

```typescript
import type { TxnType } from "@/lib/domain/types";

/** Card payment line, e.g. "DOP. VISA … PŁATNOŚĆ KARTĄ …" (incl. "ZWROT PŁATNOŚCI KARTĄ"). */
const CARD_RE = /\bP[ŁL]ATNO[ŚS][ĆC]\s+KART[ĄA]\b|\bKART[ĄA]\b.*\bPLN\b|^DOP\.?\s+VISA\b/iu;
/** BLIK line: "Zakup BLIK …", "Zwrot BLIK …", "Przelew BLIK …". */
const BLIK_RE = /\bBLIK\b/iu;
/** Own-account transfer label Santander uses. */
const INTERNAL_RE = /\bBETWEEN YOUR OWN ACCOUNTS\b|\bPRZELEW W[ŁL]ASNY\b/iu;
/** Bank-posted fee/interest lines (no counterparty). */
const FEE_RE = /^(UZNANIE|OBCI[ĄA][ŻZ]ENIE)\b/iu;

/**
 * Infer the coarse transaction type from the title (and whether a counterparty is present).
 * Order matters: card and BLIK prefixes win over the generic "has-counterparty → transfer".
 */
export function classifyTransaction(title: string, counterparty: string): TxnType {
  const t = title.trim();
  if (CARD_RE.test(t)) return "card";
  if (BLIK_RE.test(t)) return "blik";
  if (INTERNAL_RE.test(t)) return "internal";
  if (FEE_RE.test(t) && counterparty.trim() === "") return "fee";
  return "transfer";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/domain/__tests__/txnType.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add lib/domain/types.ts lib/domain/txnType.ts lib/domain/__tests__/txnType.test.ts
git commit -m "feat(import): add transaction-type classifier + counterparty types"
```

---

## Task 2: Type-aware merchant / payee extraction

**Files:**
- Rewrite: `lib/domain/merchant.ts`
- Test: `lib/domain/__tests__/merchant.test.ts` (rewrite for new signature)

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `lib/domain/__tests__/merchant.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { extractMerchant, brandNormalize } from "@/lib/domain/merchant";

const CARD_ELECLERC = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN eLeclerc 01 Gdansk";
const CARD_ALDI = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK";
const CARD_BIEDRONKA = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 19.16 PLN JMP S.A. BIEDRONKA 3808 BIALYSTOK";
const CARD_ZABKA = "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 5.99 PLN ZABKA Z9241 K.1 GDANSK";

describe("extractMerchant — card", () => {
  it("extracts the brand, dropping store# and city", () => {
    expect(extractMerchant("card", CARD_ELECLERC, "")).toBe("ELECLERC");
    expect(extractMerchant("card", CARD_ALDI, "")).toBe("ALDI");
  });

  it("extracts a brand buried after an operator prefix", () => {
    expect(extractMerchant("card", CARD_BIEDRONKA, "")).toContain("BIEDRONKA");
    expect(extractMerchant("card", CARD_ZABKA, "")).toContain("ZABKA");
  });

  it("never returns empty for a merchant-less card line", () => {
    expect(extractMerchant("card", "DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 12.48 PLN", "").length).toBeGreaterThan(0);
  });
});

describe("extractMerchant — blik", () => {
  it("prefers the counterparty, stripped to a brand", () => {
    expect(extractMerchant("blik", "Zakup BLIK Decathlon Sp. z o.o. Geodezyjna 76 ref:94077292755", "Decathlon Sp. z o.o. Geodezyjna 76")).toBe("DECATHLON");
  });

  it("falls back to the title between BLIK and ref: when counterparty is empty", () => {
    expect(extractMerchant("blik", "Zwrot BLIK PayPro S.A. Pastelowa 8 ref:93601725170", "")).toContain("PAYPRO");
  });
});

describe("extractMerchant — transfer / internal", () => {
  it("uses the counterparty name, Title-Cased, address stripped", () => {
    expect(extractMerchant("transfer", "Przelew na telefon Od: 48604263864 Do: 485*****130", "JULIA ZAKRZEWSKA")).toBe("Julia Zakrzewska");
    expect(extractMerchant("transfer", "kwiatki dla mamy", "Szymek")).toBe("Szymek");
  });

  it("strips a street address and postcode from a person", () => {
    expect(extractMerchant("transfer", "ZA KABABY", "MACIEJ IWANIUK UL.GORODZISKO 36 17-210 GORODZISKO")).toBe("Maciej Iwaniuk");
  });

  it("strips a spelled-out legal form and address from a company", () => {
    expect(
      extractMerchant("transfer", "Umowa zlecenie kwiecień 2026", "AUTOMEE SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ ALEJA GRUNWALDZKA 472B 80-236 GDAŃSK ELIXIR 08-05-2026"),
    ).toBe("Automee");
  });

  it("falls back to the cleaned title when no counterparty", () => {
    expect(extractMerchant("transfer", "Przelew środków", "").length).toBeGreaterThan(0);
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
    expect(brandNormalize("S.A.")).toBe("S.A.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/domain/__tests__/merchant.test.ts`
Expected: FAIL — `extractMerchant` still has the old single-arg signature.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `lib/domain/merchant.ts` with:

```typescript
/**
 * Pure helpers (no I/O) for deriving a clean display name (brand or payee) from a noisy
 * Santander bank-statement row. Extraction is transaction-type-aware: card lines carry the
 * merchant in the title; BLIK and transfers carry it in the counterparty column.
 */
import type { TxnType } from "@/lib/domain/types";

const CARD_MASK = /\b\d+\*+\d+\b/g;
const AMOUNT_CCY = /\b\d+[.,]\d{2}\s+(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const BOILERPLATE = /\b(?:DOP|VISA|MASTERCARD|MAESTRO|ZWROT|P[ŁL]ATNO[ŚS][ĆC]I?|KART[ĄA])\b\.?/giu;
const LONE_CCY = /\b(?:PLN|EUR|USD|GBP|CZK)\b/giu;
const LONG_DIGITS = /\b\d{4,}\b/g;

/** Card payment: "… PŁATNOŚĆ KARTĄ <amount> <CCY> <merchant>" (also "ZWROT PŁATNOŚCI KARTĄ"). */
function cardMerchant(title: string): string | null {
  const m = title.match(/P[ŁL]ATNO[ŚS][ĆC]I?\s+KART[ĄA]\s+[\d.,]+\s+[A-Za-z]{3}\s+(.+)$/u);
  return m ? m[1] : null;
}

/** BLIK title: text between "BLIK" and "ref:". */
function blikMerchant(title: string): string | null {
  const m = title.match(/\bBLIK\b\s+(?:na telefon\s+)?(.+?)(?:\s+ref:|$)/iu);
  return m ? m[1] : null;
}

/** Strip card/amount/boilerplate noise from a line, keep whatever remains. */
function genericClean(raw: string): string {
  return raw
    .replace(CARD_MASK, " ")
    .replace(AMOUNT_CCY, " ")
    .replace(BOILERPLATE, " ")
    .replace(LONE_CCY, " ")
    .replace(LONG_DIGITS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LEGAL_SUFFIX =
  /\bSP[ÓO][ŁL]KA\s+Z\s+OGRANICZON[ĄA]\s+ODPOWIEDZIALNO[ŚS]CI[ĄA]\b|\bSP[ÓO][ŁL]KA\s+AKCYJNA\b|\bSP\.?\s*Z\s*O\.?\s*O\.?\b|\bS\.?\s*A\.?\b|\bSP\.?\s*J\.?\b|\bSP\.?\s*K\.?\b/giu;
/** A trailing "<1-3 digit store#> <CITY/word>" at the end of the name. */
const TRAILING_STORE_CITY = /\s+\d{1,3}\s+[\p{L}][\p{L}.-]*$/u;

/** Collapse an extracted name to its brand: uppercase, drop legal suffixes + trailing store#/city. */
export function brandNormalize(name: string): string {
  const upper = name.toUpperCase().replace(/\s+/g, " ").trim();
  let s = upper.replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
  s = s.replace(TRAILING_STORE_CITY, "").trim();
  s = s.replace(/[.\s]+$/, "").trim();
  return s === "" ? upper : s;
}

const STREET_MARKER = /\b(?:UL|AL|PL|OS|ULICA|ALEJA|OSIEDLE)\b\.?.*$/iu;

/** Drop a trailing street address / postcode / "ELIXIR <date>" tail from a counterparty name. */
function stripCounterpartyAddress(s: string): string {
  let out = s.replace(/\bELIXIR\b.*$/iu, " "); // settlement-system tail
  out = out.replace(STREET_MARKER, " "); // "UL. KROKUSOWA 9 …", "ALEJA GRUNWALDZKA …"
  out = out.replace(/\s\d.*$/u, " "); // cut from the first standalone number onward
  return out.replace(/\s+/g, " ").trim();
}

/** Title-case a (possibly ALL-CAPS) person/company name, diacritics preserved. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Clean a counterparty to a display name: strip address + legal form, Title-Case. */
function cleanCounterparty(cp: string): string {
  const noAddr = stripCounterpartyAddress(cp);
  const noLegal = noAddr.replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
  const base = noLegal === "" ? noAddr : noLegal;
  return titleCase(base) || cp.trim();
}

/**
 * Derive a clean display name for a transaction. `card`/`fee` read the title; `blik` prefers the
 * counterparty (falling back to the BLIK title segment); `transfer`/`internal` use the counterparty
 * name. Never returns an empty string.
 */
export function extractMerchant(type: TxnType, title: string, counterparty: string): string {
  const cp = counterparty.trim();
  switch (type) {
    case "blik":
      if (cp) return brandNormalize(cp);
      return brandNormalize(blikMerchant(title) ?? genericClean(title));
    case "transfer":
    case "internal":
      if (cp) return cleanCounterparty(cp);
      return brandNormalize(genericClean(title));
    case "card":
    case "fee":
    default:
      return brandNormalize(cardMerchant(title) ?? genericClean(title));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/domain/__tests__/merchant.test.ts`
Expected: PASS. If `AUTOMEE` case fails, confirm `stripCounterpartyAddress` cut at the first number leaves `AUTOMEE SPÓŁKA … ODPOWIEDZIALNOŚCIĄ ALEJA GRUNWALDZKA` then `STREET_MARKER` removes from `ALEJA` and `LEGAL_SUFFIX` removes the spelled-out form → `AUTOMEE`.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/merchant.ts lib/domain/__tests__/merchant.test.ts
git commit -m "feat(import): type-aware merchant/payee extraction"
```

---

## Task 3: Counterparty in CSV mapping + column roles

**Files:**
- Modify: `lib/csv/mapping.ts`
- Modify: `lib/csv/roles.ts`
- Test: `lib/csv/__tests__/mapping.test.ts` (create if absent), `lib/csv/__tests__/roles.test.ts` (create if absent)

- [ ] **Step 1: Write the failing mapping test**

Create/append `lib/csv/__tests__/mapping.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyMapping } from "@/lib/csv/mapping";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

const MAPPING: ColumnMapping = {
  dateColumn: "Column 1",
  dateFormat: "DD-MM-YYYY",
  descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4",
  counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

const ROW: RawRow = {
  "Column 1": "31-05-2026",
  "Column 2": "31-05-2026",
  "Column 3": "Przelew na telefon Od: 48604263864 Do: 485*****130",
  "Column 4": "JULIA ZAKRZEWSKA",
  "Column 5": "PL18 1020 1752 0000 0102 0167 4100",
  "Column 6": "70,00",
};

describe("applyMapping with counterparty", () => {
  it("captures title and counterparty separately", () => {
    const f = applyMapping(ROW, MAPPING);
    expect(f.title).toBe("Przelew na telefon Od: 48604263864 Do: 485*****130");
    expect(f.counterparty).toBe("JULIA ZAKRZEWSKA");
  });

  it("reconstructs raw_description from title + counterparty + account", () => {
    const f = applyMapping(ROW, MAPPING);
    expect(f.rawDescription).toContain("JULIA ZAKRZEWSKA");
    expect(f.rawDescription).toContain("Przelew na telefon");
    expect(f.rawDescription).toContain("PL18 1020 1752");
  });

  it("leaves counterparty empty when the column is unmapped", () => {
    const cardRow: RawRow = { ...ROW, "Column 4": "", "Column 5": "" };
    const noCp: ColumnMapping = { ...MAPPING, counterpartyColumn: undefined, counterpartyAccountColumn: undefined };
    const f = applyMapping(cardRow, noCp);
    expect(f.counterparty).toBe("");
    expect(f.rawDescription).toBe("Przelew na telefon Od: 48604263864 Do: 485*****130");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/csv/__tests__/mapping.test.ts`
Expected: FAIL — `f.title`/`f.counterparty` undefined.

- [ ] **Step 3: Update `applyMapping`**

Replace `lib/csv/mapping.ts` lines 27-38 (the `rawDescription`/`currency`/`return` block) with:

```typescript
  const title = mapping.descriptionColumns
    .map((c) => requireColumn(row, c).trim())
    .filter((v) => v !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const optional = (col?: string): string => (col ? (row[col] ?? "").trim() : "");
  const counterparty = optional(mapping.counterpartyColumn);
  const counterpartyAccount = optional(mapping.counterpartyAccountColumn);

  const rawDescription = [title, counterparty, counterpartyAccount]
    .filter((v) => v !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const currency = mapping.currencyColumn
    ? requireColumn(row, mapping.currencyColumn).trim() || mapping.defaultCurrency
    : mapping.defaultCurrency;

  return { bookedAt, amountMinor, currency, title, counterparty, rawDescription };
```

- [ ] **Step 4: Run mapping test to verify it passes**

Run: `npx vitest run lib/csv/__tests__/mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing roles test**

Create/append `lib/csv/__tests__/roles.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildMapping, mappingToRoles } from "@/lib/csv/roles";

describe("buildMapping — counterparty roles", () => {
  it("maps counterparty + counterparty-account columns", () => {
    const m = buildMapping({
      roles: { 0: "date", 2: "description", 3: "counterparty", 4: "counterpartyAccount", 5: "amount" },
      dateFormat: "DD-MM-YYYY",
      decimalSep: ",",
      defaultCurrency: "PLN",
    });
    expect(m).not.toBeNull();
    expect(m!.counterpartyColumn).toBe("Column 4");
    expect(m!.counterpartyAccountColumn).toBe("Column 5");
  });

  it("round-trips through mappingToRoles", () => {
    const m = buildMapping({
      roles: { 0: "date", 2: "description", 3: "counterparty", 5: "amount" },
      dateFormat: "DD-MM-YYYY",
      decimalSep: ",",
      defaultCurrency: "PLN",
    })!;
    expect(mappingToRoles(m)[3]).toBe("counterparty");
  });
});
```

- [ ] **Step 6: Run roles test to verify it fails**

Run: `npx vitest run lib/csv/__tests__/roles.test.ts`
Expected: FAIL — `"counterparty"` not assignable to `ColumnRole`.

- [ ] **Step 7: Update `roles.ts`**

In `lib/csv/roles.ts`, change the `ColumnRole` union (line 4) to:

```typescript
export type ColumnRole =
  | "ignore"
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "currency"
  | "counterparty"
  | "counterpartyAccount";
```

In `buildMapping`, after the `currencyIdx` line (line 37) add:

```typescript
  const counterpartyIdx = firstWithRole(draft.roles, "counterparty");
  const counterpartyAccountIdx = firstWithRole(draft.roles, "counterpartyAccount");
```

In the returned object (lines 50-58), add before `defaultCurrency`:

```typescript
    counterpartyColumn: counterpartyIdx !== null ? columnKey(counterpartyIdx) : undefined,
    counterpartyAccountColumn: counterpartyAccountIdx !== null ? columnKey(counterpartyAccountIdx) : undefined,
```

In `mappingToRoles`, before the final `return roles;` (line 77) add:

```typescript
  if (mapping.counterpartyColumn) set(mapping.counterpartyColumn, "counterparty");
  if (mapping.counterpartyAccountColumn) set(mapping.counterpartyAccountColumn, "counterpartyAccount");
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `npx vitest run lib/csv/__tests__/mapping.test.ts lib/csv/__tests__/roles.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/csv/mapping.ts lib/csv/roles.ts lib/csv/__tests__/mapping.test.ts lib/csv/__tests__/roles.test.ts
git commit -m "feat(import): map counterparty name + account columns"
```

---

## Task 4: Seed merchant dictionary + rule persistence helpers

**Files:**
- Create: `lib/categorize/seedRules.ts`
- Modify: `lib/repos/merchantMap.ts`
- Test: `lib/categorize/__tests__/seedRules.test.ts`

- [ ] **Step 1: Create the seed dictionary**

Create `lib/categorize/seedRules.ts`. Categories MUST match the seeded taxonomy exactly: Groceries, Dining, Transport, Utilities, Housing, Health, Entertainment, Shopping, Subscriptions, Income, Transfer, Other.

```typescript
/**
 * Curated Polish-merchant → category dictionary, applied as case-insensitive `contains`
 * rules over the reconstructed description (so noisy lines like "JMP S.A. BIEDRONKA 4014"
 * still match on the brand keyword). Single source of truth; loaded into merchant_map by
 * seedMerchantRules(). Patterns chosen to avoid cross-category substring collisions.
 *
 * Known gap (intentionally absent): online-payment gateways (PayU, PayPro, tpay, Paynow,
 * Cashbill, IdoPay) mask the real merchant — left for the user to correct, then remembered.
 */
export interface SeedRule {
  pattern: string;
  matchType: "contains" | "exact";
  categoryName: string;
}

export const SEED_RULES: SeedRule[] = [
  // Groceries
  { pattern: "LIDL", matchType: "contains", categoryName: "Groceries" },
  { pattern: "BIEDRONKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "ALDI", matchType: "contains", categoryName: "Groceries" },
  { pattern: "ZABKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "ŻABKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "LECLERC", matchType: "contains", categoryName: "Groceries" },
  { pattern: "CARREFOUR", matchType: "contains", categoryName: "Groceries" },
  { pattern: "KAUFLAND", matchType: "contains", categoryName: "Groceries" },
  { pattern: "AUCHAN", matchType: "contains", categoryName: "Groceries" },
  { pattern: "TOP MARKET", matchType: "contains", categoryName: "Groceries" },
  { pattern: "DELIKATESY", matchType: "contains", categoryName: "Groceries" },
  { pattern: "NETTO", matchType: "contains", categoryName: "Groceries" },
  { pattern: "STOKROTKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "DINO", matchType: "contains", categoryName: "Groceries" },
  // Dining (put EATS before any generic UBER rule; we don't add a bare UBER rule)
  { pattern: "UBER * EATS", matchType: "contains", categoryName: "Dining" },
  { pattern: "MCDONALD", matchType: "contains", categoryName: "Dining" },
  { pattern: "KEBAB", matchType: "contains", categoryName: "Dining" },
  { pattern: "SUSHI", matchType: "contains", categoryName: "Dining" },
  { pattern: "BAR MLECZNY", matchType: "contains", categoryName: "Dining" },
  { pattern: "PIZZA", matchType: "contains", categoryName: "Dining" },
  { pattern: "GLOVO", matchType: "contains", categoryName: "Dining" },
  { pattern: "PYSZNE", matchType: "contains", categoryName: "Dining" },
  { pattern: "KFC", matchType: "contains", categoryName: "Dining" },
  { pattern: "STARBUCKS", matchType: "contains", categoryName: "Dining" },
  // Transport
  { pattern: "JAKDOJADE", matchType: "contains", categoryName: "Transport" },
  { pattern: "BKM", matchType: "contains", categoryName: "Transport" },
  { pattern: "BOLT.EU", matchType: "contains", categoryName: "Transport" },
  { pattern: "CITYBIKE", matchType: "contains", categoryName: "Transport" },
  { pattern: "CITY-NAV", matchType: "contains", categoryName: "Transport" },
  { pattern: "INTERCITY", matchType: "contains", categoryName: "Transport" },
  { pattern: "ORLEN", matchType: "contains", categoryName: "Transport" },
  { pattern: "SYSTEMFALA", matchType: "contains", categoryName: "Transport" },
  { pattern: "MPK", matchType: "contains", categoryName: "Transport" },
  // Health
  { pattern: "ZDROFIT", matchType: "contains", categoryName: "Health" },
  { pattern: "FOX MED", matchType: "contains", categoryName: "Health" },
  { pattern: "NZOZ", matchType: "contains", categoryName: "Health" },
  { pattern: "SUPER-PHARM", matchType: "contains", categoryName: "Health" },
  { pattern: "ROSSMANN", matchType: "contains", categoryName: "Health" },
  { pattern: "APTEKA", matchType: "contains", categoryName: "Health" },
  { pattern: "FIZJO", matchType: "contains", categoryName: "Health" },
  { pattern: "BARBERWAVE", matchType: "contains", categoryName: "Health" },
  // Shopping
  { pattern: "IKEA", matchType: "contains", categoryName: "Shopping" },
  { pattern: "JYSK", matchType: "contains", categoryName: "Shopping" },
  { pattern: "LEROY MERLIN", matchType: "contains", categoryName: "Shopping" },
  { pattern: "MEDIA MARKT", matchType: "contains", categoryName: "Shopping" },
  { pattern: "EURO-NET", matchType: "contains", categoryName: "Shopping" },
  { pattern: "TEMU", matchType: "contains", categoryName: "Shopping" },
  { pattern: "DECATHLON", matchType: "contains", categoryName: "Shopping" },
  { pattern: "EMPIK", matchType: "contains", categoryName: "Shopping" },
  { pattern: "EOBUWIE", matchType: "contains", categoryName: "Shopping" },
  { pattern: "AGATA", matchType: "contains", categoryName: "Shopping" },
  { pattern: "ALLEGRO", matchType: "contains", categoryName: "Shopping" },
  // Subscriptions
  { pattern: "NETFLIX", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "SPOTIFY", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "YOUTUBE", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "OPENAI", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "ANTHROPIC", matchType: "contains", categoryName: "Subscriptions" },
  // Housing (matches the note in the reconstructed description)
  { pattern: "CZYNSZ", matchType: "contains", categoryName: "Housing" },
  { pattern: "KAUCJA", matchType: "contains", categoryName: "Housing" },
  // Income
  { pattern: "UMOWA ZLECENIE", matchType: "contains", categoryName: "Income" },
  { pattern: "WYNAGRODZENIE", matchType: "contains", categoryName: "Income" },
  { pattern: "ODSETKI", matchType: "contains", categoryName: "Income" },
  // Transfer (internal moves)
  { pattern: "BETWEEN YOUR OWN ACCOUNTS", matchType: "contains", categoryName: "Transfer" },
  // Other (bank fees/tax)
  { pattern: "PODATEK", matchType: "contains", categoryName: "Other" },
];
```

- [ ] **Step 2: Write the failing repo test**

Create `lib/categorize/__tests__/seedRules.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SEED_RULES } from "@/lib/categorize/seedRules";
import { categorizeByRules } from "@/lib/categorize/rules";
import type { MerchantRule } from "@/lib/domain/types";

// Build in-memory rules with the category NAME used as a stand-in id, sorted exact→contains.
const PRIORITY = { exact: 0, contains: 1, regex: 2 } as const;
const rules: MerchantRule[] = SEED_RULES.map((r) => ({
  matchType: r.matchType,
  pattern: r.pattern,
  categoryId: r.categoryName,
})).sort((a, b) => PRIORITY[a.matchType] - PRIORITY[b.matchType]);

const cat = (raw: string, merchant = "") => categorizeByRules(raw, merchant, rules);

describe("seed rules categorize real Santander lines", () => {
  it("groceries", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK")).toBe("Groceries");
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 19.16 PLN JMP S.A. BIEDRONKA 3808 BIALYSTOK")).toBe("Groceries");
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 5.99 PLN ZABKA Z9241 K.1 GDANSK")).toBe("Groceries");
  });
  it("transport", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 25.00 PLN jakdojade.pl Poznan")).toBe("Transport");
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 11.49 PLN ORLEN STACJA NR 1419 BIALYSTOK")).toBe("Transport");
  });
  it("dining keeps UBER EATS out of transport", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 74.98 PLN UBER * EATS PENDING AMSTERDAM")).toBe("Dining");
  });
  it("housing from the transfer note", () => {
    expect(cat("Czynsz i opłaty kwiecień Radek Właściciel")).toBe("Housing");
  });
  it("income from a salary note", () => {
    expect(cat("Umowa zlecenie kwiecień 2026 Automee")).toBe("Income");
  });
  it("returns null for an unknown merchant", () => {
    expect(cat("DOP. VISA … PŁATNOŚĆ KARTĄ 87.00 PLN MB&SJ COMPANY Gdansk")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `npx vitest run lib/categorize/__tests__/seedRules.test.ts`
Expected: FAIL first (module missing) → after Step 1 is saved, PASS. (No implementation beyond `seedRules.ts` is needed for this test — it exercises the existing `categorizeByRules`.)

- [ ] **Step 4: Add `seedMerchantRules` + `insertAiRuleIfAbsent` to the repo**

Append to `lib/repos/merchantMap.ts`:

```typescript
import { SEED_RULES } from "@/lib/categorize/seedRules";
import { getCategoryNameToId } from "@/lib/repos/categories";

/**
 * Idempotently load SEED_RULES into merchant_map (source='seed'). Skips any rule whose
 * (pattern, match_type) already exists, and silently skips patterns whose category name
 * isn't in the taxonomy. Returns the number of rules inserted.
 */
export async function seedMerchantRules(db: Db): Promise<number> {
  const nameToId = await getCategoryNameToId(db);
  const { data: existing, error } = await db.from("merchant_map").select("pattern, match_type");
  if (error) throw new Error(error.message);
  const seen = new Set((existing ?? []).map((r) => `${r.match_type}::${r.pattern}`));

  const toInsert = SEED_RULES.flatMap((r) => {
    const categoryId = nameToId.get(r.categoryName);
    if (!categoryId) return [];
    if (seen.has(`${r.matchType}::${r.pattern}`)) return [];
    return [{ pattern: r.pattern, match_type: r.matchType, category_id: categoryId, source: "seed" }];
  });
  if (toInsert.length === 0) return 0;

  const { error: insErr } = await db.from("merchant_map").insert(toInsert);
  if (insErr) throw new Error(insErr.message);
  return toInsert.length;
}

/**
 * Persist a learned rule from a confident AI categorization — but only if no rule with the
 * same (pattern, match_type) already exists, so we never clobber a user or seed rule.
 * Returns true if a new rule was written.
 */
export async function insertAiRuleIfAbsent(
  db: Db,
  input: { pattern: string; matchType: MerchantRule["matchType"]; categoryId: string },
): Promise<boolean> {
  const { data: existing, error: selErr } = await db
    .from("merchant_map")
    .select("id")
    .eq("pattern", input.pattern)
    .eq("match_type", input.matchType)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return false;

  const { error } = await db.from("merchant_map").insert({
    pattern: input.pattern,
    match_type: input.matchType,
    category_id: input.categoryId,
    source: "ai",
  });
  if (error) throw new Error(error.message);
  return true;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms the `merchant_map.source` value `'seed'`/`'ai'` and `match_type` types are accepted; both are allowed by the schema check constraint).

- [ ] **Step 6: Commit**

```bash
git add lib/categorize/seedRules.ts lib/categorize/__tests__/seedRules.test.ts lib/repos/merchantMap.ts
git commit -m "feat(categorize): seed Polish merchant dictionary + AI-rule learning helpers"
```

---

## Task 5: Wire type-aware extraction into the import pipeline

**Files:**
- Modify: `lib/import/pipeline.ts`
- Test: `lib/import/__tests__/pipeline.test.ts` (append cases)

- [ ] **Step 1: Append failing pipeline cases**

Append to `lib/import/__tests__/pipeline.test.ts` (inside or after the existing describe block; if the file imports differ, keep its existing imports and add this block):

```typescript
import { describe, it, expect } from "vitest";
import { buildTransactionDrafts } from "@/lib/import/pipeline";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

const SANTANDER: ColumnMapping = {
  dateColumn: "Column 1",
  dateFormat: "DD-MM-YYYY",
  descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4",
  counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

const row = (c3: string, c4: string, c5: string, c6: string): RawRow => ({
  "Column 1": "31-05-2026",
  "Column 3": c3,
  "Column 4": c4,
  "Column 5": c5,
  "Column 6": c6,
});

describe("buildTransactionDrafts — Santander types", () => {
  it("recovers the payee name and tags the type for a phone transfer", () => {
    const { drafts } = buildTransactionDrafts({
      accountId: "acc-1",
      rows: [row("Przelew na telefon Od: 48604263864 Do: 485*****130", "JULIA ZAKRZEWSKA", "PL18 1020 1752 0000 0102 0167 4100", "70,00")],
      mapping: SANTANDER,
      rules: [],
    });
    expect(drafts[0].merchant).toBe("Julia Zakrzewska");
    expect(drafts[0].txnType).toBe("transfer");
    expect(drafts[0].rawDescription).toContain("JULIA ZAKRZEWSKA");
  });

  it("extracts the brand and tags 'card' for a card payment", () => {
    const { drafts } = buildTransactionDrafts({
      accountId: "acc-1",
      rows: [row("DOP. VISA 421352******0246 PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK", "", "", "-3,39")],
      mapping: SANTANDER,
      rules: [],
    });
    expect(drafts[0].merchant).toBe("ALDI");
    expect(drafts[0].txnType).toBe("card");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/import/__tests__/pipeline.test.ts`
Expected: FAIL — `extractMerchant` is still called with one arg / `txnType` undefined.

- [ ] **Step 3: Update the pipeline**

In `lib/import/pipeline.ts`, add the import (after line 11):

```typescript
import { classifyTransaction } from "@/lib/domain/txnType";
```

Replace the body of the `try { … }` block (lines 38-69) with:

```typescript
      const fields = applyMapping(row, input.mapping);
      const txnType = classifyTransaction(fields.title, fields.counterparty);
      const merchant = extractMerchant(txnType, fields.title, fields.counterparty);

      // Dedup hash is built from the TITLE (not the enriched rawDescription) to stay stable
      // across the extraction change and avoid duplicate explosions on re-import.
      const baseKey = JSON.stringify([
        input.accountId,
        fields.bookedAt,
        fields.amountMinor,
        canonicalizeForHash(fields.title),
      ]);
      const occurrence = occurrenceCounts.get(baseKey) ?? 0;
      occurrenceCounts.set(baseKey, occurrence + 1);

      const dedupHash = computeDedupHash({
        accountId: input.accountId,
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        rawDescription: fields.title,
        occurrence,
      });

      const categoryId = categorizeByRules(fields.rawDescription, merchant, input.rules);

      drafts.push({
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        currency: fields.currency,
        rawDescription: fields.rawDescription,
        merchant,
        txnType,
        dedupHash,
        categoryId,
        categorySource: categoryId ? "rule" : "uncategorized",
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/import/__tests__/pipeline.test.ts`
Expected: PASS. (Existing pipeline cases that used the old single-column mapping still pass — `counterparty` defaults to "" when unmapped, and `title` equals the former `rawDescription`, so their dedup hashes are unchanged.)

- [ ] **Step 5: Commit**

```bash
git add lib/import/pipeline.ts lib/import/__tests__/pipeline.test.ts
git commit -m "feat(import): classify type, extract payee, hash on title"
```

---

## Task 6: AI prompt (note + amount sign) + learning loop

**Files:**
- Modify: `lib/ai/categorize.ts` (prompt only)
- Modify: `lib/import/ai-apply.ts` (add `AI_LEARN_THRESHOLD`)
- Modify: `lib/import/run.ts` (persist confident AI rules for real merchants)
- Test: `lib/import/__tests__/run.itest.ts` is integration; add a focused unit check for the learn-eligibility helper instead.

- [ ] **Step 1: Improve the AI system prompt**

In `lib/ai/categorize.ts`, replace the `SYSTEM` constant (lines 30-33) with:

```typescript
const SYSTEM = `You categorize Polish bank transactions into a fixed set of spending categories.
For each transaction choose exactly one category from the taxonomy, or "Unknown" if not reasonably sure.
Use ALL fields: "merchant" is the payee (a shop brand or a person's name), "description" is the full
bank line (it often contains a human note like a rent or gift purpose), and "amountMinor" is signed —
negative means money out (an expense), positive means money in (income or an incoming transfer).
Person-to-person transfers are usually "Transfer" unless the note clearly indicates otherwise
(e.g. rent → Housing, salary → Income). "confidence" is your certainty from 0 to 1.
Respond with ONLY a JSON object of the form {"results":[{"id":string,"category":string,"confidence":number}]} and nothing else — no prose, no code fences.`;
```

(No signature change — `run.ts` already passes the enriched `rawDescription` as `description` and `amountMinor`.)

- [ ] **Step 2: Add the learn threshold**

In `lib/import/ai-apply.ts`, after `AI_CONFIDENCE_THRESHOLD` (line 5) add:

```typescript
/** Minimum confidence to PERSIST an AI guess as a reusable rule (stricter than auto-apply). */
export const AI_LEARN_THRESHOLD = 0.8;
```

- [ ] **Step 3: Write the failing learn-eligibility test**

Create `lib/import/__tests__/learn.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { learnableRules } from "@/lib/import/run";
import type { TransactionDraft } from "@/lib/domain/types";
import type { CategorySuggestion } from "@/lib/ai/categorize";

const draft = (merchant: string, txnType: TransactionDraft["txnType"]): TransactionDraft => ({
  bookedAt: "2026-05-31", amountMinor: -1000, currency: "PLN",
  rawDescription: merchant, merchant, txnType,
  dedupHash: merchant, categoryId: null, categorySource: "uncategorized",
});

describe("learnableRules", () => {
  const nameToId = new Map([["Groceries", "cat-groceries"], ["Transfer", "cat-transfer"]]);

  it("learns an exact rule for a confident card/blik merchant", () => {
    const drafts = [draft("ALDI", "card")];
    const suggestions = new Map<string, CategorySuggestion>([["ALDI", { id: "ALDI", category: "Groceries", confidence: 0.95 }]]);
    expect(learnableRules(drafts, suggestions, nameToId)).toEqual([
      { pattern: "ALDI", matchType: "exact", categoryId: "cat-groceries" },
    ]);
  });

  it("does NOT learn for person-to-person transfers (category varies per txn)", () => {
    const drafts = [draft("Julia Zakrzewska", "transfer")];
    const suggestions = new Map<string, CategorySuggestion>([["Julia Zakrzewska", { id: "Julia Zakrzewska", category: "Transfer", confidence: 0.99 }]]);
    expect(learnableRules(drafts, suggestions, nameToId)).toEqual([]);
  });

  it("does NOT learn below the threshold or for unknown categories", () => {
    const drafts = [draft("MB&SJ", "card"), draft("FOO", "card")];
    const suggestions = new Map<string, CategorySuggestion>([
      ["MB&SJ", { id: "MB&SJ", category: "Groceries", confidence: 0.5 }],
      ["FOO", { id: "FOO", category: "Unknown", confidence: 0.99 }],
    ]);
    expect(learnableRules(drafts, suggestions, nameToId)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/import/__tests__/learn.test.ts`
Expected: FAIL — `learnableRules` not exported.

- [ ] **Step 5: Implement `learnableRules` and call it in `runImport`**

In `lib/import/run.ts`, update the imports (lines 5-10 area) to add:

```typescript
import { AI_LEARN_THRESHOLD } from "@/lib/import/ai-apply";
import { loadRules, insertAiRuleIfAbsent } from "@/lib/repos/merchantMap";
```

(Replace the existing `import { loadRules } from "@/lib/repos/merchantMap";` line — do not import it twice.)

Add this exported pure helper near the top of the file (after the interfaces, before `runImport`):

```typescript
/**
 * Decide which confident AI suggestions deserve a remembered rule. Only real merchants
 * (card/blik) qualify — person-to-person transfers vary per transaction, so learning a
 * per-person rule would be wrong. Returns one `exact` rule per distinct eligible merchant.
 */
export function learnableRules(
  drafts: TransactionDraft[],
  suggestionByMerchant: Map<string, CategorySuggestion>,
  nameToId: Map<string, string>,
): { pattern: string; matchType: "exact"; categoryId: string }[] {
  const out = new Map<string, { pattern: string; matchType: "exact"; categoryId: string }>();
  for (const d of drafts) {
    if (!d.merchant || (d.txnType !== "card" && d.txnType !== "blik")) continue;
    const sugg = suggestionByMerchant.get(d.merchant);
    if (!sugg || sugg.confidence < AI_LEARN_THRESHOLD) continue;
    const categoryId = nameToId.get(sugg.category);
    if (!categoryId) continue;
    out.set(d.merchant, { pattern: d.merchant, matchType: "exact", categoryId });
  }
  return [...out.values()];
}
```

Add `TransactionDraft` to the type import at the top of `run.ts`:

```typescript
import type { ColumnMapping, RawRow, TransactionDraft } from "@/lib/domain/types";
```

In `runImport`, inside the `if (unknownMerchants.length > 0) { … }` block, right after `aiCategorized = …` (line 77), add:

```typescript
      // Remember confident merchant categorizations so future imports skip the AI.
      try {
        for (const rule of learnableRules(categorized, byMerchant, nameToId)) {
          await insertAiRuleIfAbsent(db, rule);
        }
      } catch {
        // best-effort: a failed rule write must not fail the import
      }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/import/__tests__/learn.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/categorize.ts lib/import/ai-apply.ts lib/import/run.ts lib/import/__tests__/learn.test.ts
git commit -m "feat(categorize): note+sign-aware AI prompt; remember confident merchant rules"
```

---

## Task 7: Add counterparty roles to the import mapping UI

**Files:**
- Modify: `components/import/import-preview.tsx`

- [ ] **Step 1: Add the two roles to the dropdown**

In `components/import/import-preview.tsx`, replace the `ROLES` array (lines 10-18) with:

```typescript
const ROLES: { value: ColumnRole; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "counterparty", label: "Counterparty" },
  { value: "counterpartyAccount", label: "Counterparty account" },
  { value: "amount", label: "Amount" },
  { value: "debit", label: "Debit" },
  { value: "credit", label: "Credit" },
  { value: "currency", label: "Currency" },
];
```

- [ ] **Step 2: Update the helper hint text**

Replace the help paragraph (lines 87-90) with:

```tsx
      <p className="text-xs text-muted-foreground">
        Each column&apos;s dropdown sets its role. For transfers, set the payee column to
        <strong> Counterparty</strong> so names aren&apos;t lost. Click a row to mark where transactions
        start — rows above it (account info, headers) are skipped.
      </p>
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run typecheck`
Expected: no errors (the `ColumnRole` union from Task 3 already includes the new values).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/import/import-preview.tsx
git commit -m "feat(import-ui): counterparty + counterparty-account column roles"
```

---

## Task 8: Backfill existing data (categories) + CSV-enrich (names)

**Files:**
- Modify: `lib/transactions/backfillMerchants.ts`
- Modify: `scripts/backfill-merchants.ts`
- Test: `lib/transactions/__tests__/backfill.itest.ts` (integration, real Supabase)

- [ ] **Step 1: Update DB-only backfill to be type-aware**

In `lib/transactions/backfillMerchants.ts`, update imports (after line 3):

```typescript
import { classifyTransaction } from "@/lib/domain/txnType";
```

Replace the per-row merchant line (line 39):

```typescript
      const merchant = extractMerchant(t.raw_description);
```

with (DB-only backfill has just the stored line; treat it as the title, no counterparty):

```typescript
      const txnType = classifyTransaction(t.raw_description, "");
      const merchant = extractMerchant(txnType, t.raw_description, "");
```

- [ ] **Step 2: Add `enrichFromCsv` for name recovery**

Append to `lib/transactions/backfillMerchants.ts`:

```typescript
import type { ColumnMapping, RawRow } from "@/lib/domain/types";
import { applyMapping } from "@/lib/csv/mapping";
import { computeDedupHash, canonicalizeForHash } from "@/lib/domain/normalize";

export interface EnrichResult {
  matched: number;
  updated: number;
  unmatched: number;
}

/**
 * Recover counterparty names for ALREADY-IMPORTED rows from the original CSV without creating
 * duplicates. For each CSV row we recompute the (title-based) dedup hash exactly as the importer
 * does, find the existing transaction by (account_id, dedup_hash), and update its raw_description
 * + merchant — and its category when the row was not user-corrected. Idempotent.
 */
export async function enrichFromCsv(
  db: Db,
  input: { accountId: string; rows: RawRow[]; mapping: ColumnMapping },
): Promise<EnrichResult> {
  const rules = await loadRules(db);
  const result: EnrichResult = { matched: 0, updated: 0, unmatched: 0 };
  const occurrence = new Map<string, number>();

  for (const row of input.rows) {
    let fields;
    try {
      fields = applyMapping(row, input.mapping);
    } catch {
      continue; // skip unparseable rows (e.g. the preamble)
    }
    const txnType = classifyTransaction(fields.title, fields.counterparty);
    const merchant = extractMerchant(txnType, fields.title, fields.counterparty);

    const baseKey = JSON.stringify([input.accountId, fields.bookedAt, fields.amountMinor, canonicalizeForHash(fields.title)]);
    const occ = occurrence.get(baseKey) ?? 0;
    occurrence.set(baseKey, occ + 1);
    const dedupHash = computeDedupHash({
      accountId: input.accountId,
      bookedAt: fields.bookedAt,
      amountMinor: fields.amountMinor,
      rawDescription: fields.title,
      occurrence: occ,
    });

    const { data: existing, error } = await db
      .from("transactions")
      .select("id, category_id, category_source")
      .eq("account_id", input.accountId)
      .eq("dedup_hash", dedupHash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!existing) {
      result.unmatched++;
      continue;
    }
    result.matched++;

    const update: TxUpdate = { raw_description: fields.rawDescription, merchant };
    if (existing.category_source !== "user") {
      const categoryId = categorizeByRules(fields.rawDescription, merchant, rules);
      if (categoryId) {
        update.category_id = categoryId;
        update.category_source = "rule";
        update.ai_confidence = null;
      }
    }
    const { error: upErr } = await db.from("transactions").update(update).eq("id", existing.id);
    if (upErr) throw new Error(upErr.message);
    result.updated++;
  }
  return result;
}
```

- [ ] **Step 3: Update the CLI script to seed + (optionally) enrich**

Replace `scripts/backfill-merchants.ts` with:

```typescript
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ColumnMapping } from "@/lib/domain/types";
import { backfillMerchants, enrichFromCsv } from "@/lib/transactions/backfillMerchants";
import { seedMerchantRules } from "@/lib/repos/merchantMap";
import { parseCsvMatrixBuffer, matrixToRawRows } from "@/lib/csv/parse";

/** Fixed Santander Bank Polska layout (9 columns, no header, preamble on row 1). */
const SANTANDER_MAPPING: ColumnMapping = {
  dateColumn: "Column 1",
  dateFormat: "DD-MM-YYYY",
  descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4",
  counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

async function main() {
  config({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const seeded = await seedMerchantRules(db);
  console.log(`Seeded ${seeded} merchant rule(s).`);

  // Optional CSV-enrich:  tsx scripts/backfill-merchants.ts <csvFile> <accountId>
  const [csvFile, accountId] = process.argv.slice(2);
  if (csvFile && accountId) {
    const buf = readFileSync(csvFile);
    const { columns, rows } = parseCsvMatrixBuffer(buf);
    const dataRows = matrixToRawRows(rows.slice(1), columns); // drop the preamble row
    const enriched = await enrichFromCsv(db, { accountId, rows: dataRows, mapping: SANTANDER_MAPPING });
    console.log(`Enrich from ${csvFile}: matched=${enriched.matched}, updated=${enriched.updated}, unmatched=${enriched.unmatched}`);
  }

  const result = await backfillMerchants(db);
  console.log(`Backfill: scanned=${result.scanned}, merchantsUpdated=${result.merchantsUpdated}, recategorized=${result.recategorized}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Write the integration test**

Create `lib/transactions/__tests__/backfill.itest.ts` (runs against the local Supabase used by other `*.itest.ts`). Mirror an existing integration test's setup for the admin client / cleanup; the assertions:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedMerchantRules } from "@/lib/repos/merchantMap";
import { enrichFromCsv, backfillMerchants } from "@/lib/transactions/backfillMerchants";
import { insertDrafts } from "@/lib/repos/transactions";
import { computeDedupHash } from "@/lib/domain/normalize";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

const db = createAdminClient();
const MAPPING: ColumnMapping = {
  dateColumn: "Column 1", dateFormat: "DD-MM-YYYY", descriptionColumns: ["Column 3"],
  counterpartyColumn: "Column 4", counterpartyAccountColumn: "Column 5",
  amount: { mode: "signed", amountColumn: "Column 6" }, decimalSep: ",", defaultCurrency: "PLN",
};

async function makeAccount(): Promise<string> {
  const { data, error } = await db.from("accounts").insert({ name: `t-${Date.now()}` }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

describe("enrichFromCsv (integration)", () => {
  it("recovers a transfer payee name on an existing row without duplicating", async () => {
    const accountId = await makeAccount();
    await seedMerchantRules(db);

    // Simulate an OLD import: title-only raw_description, hash built from the title.
    const title = "Przelew na telefon Od: 48604263864 Do: 485*****130";
    const dedupHash = computeDedupHash({ accountId, bookedAt: "2026-05-31", amountMinor: 7000, rawDescription: title, occurrence: 0 });
    await insertDrafts(db, accountId, null, [{
      bookedAt: "2026-05-31", amountMinor: 7000, currency: "PLN",
      rawDescription: title, merchant: "PRZELEW NA TELEFON OD DO",
      dedupHash, categoryId: null, categorySource: "uncategorized",
    }]);

    const row: RawRow = {
      "Column 1": "31-05-2026", "Column 3": title,
      "Column 4": "JULIA ZAKRZEWSKA", "Column 5": "PL18 1020 1752 0000 0102 0167 4100", "Column 6": "70,00",
    };
    const res = await enrichFromCsv(db, { accountId, rows: [row], mapping: MAPPING });
    expect(res.matched).toBe(1);
    expect(res.updated).toBe(1);

    const { data } = await db.from("transactions").select("merchant, raw_description").eq("account_id", accountId);
    expect(data!.length).toBe(1); // no duplicate created
    expect(data![0].merchant).toBe("Julia Zakrzewska");
    expect(data![0].raw_description).toContain("JULIA ZAKRZEWSKA");

    await db.from("transactions").delete().eq("account_id", accountId);
    await db.from("accounts").delete().eq("id", accountId);
  });
});
```

If `accounts` requires extra non-null columns in this schema, adjust `makeAccount` to match the columns used by the existing `run.itest.ts` fixture.

- [ ] **Step 5: Run the integration test**

Ensure local Supabase is running (`npx supabase start`), then:
Run: `npm run test:integration -- lib/transactions/__tests__/backfill.itest.ts`
Expected: PASS — one row, payee recovered, no duplicate.

- [ ] **Step 6: Commit**

```bash
git add lib/transactions/backfillMerchants.ts scripts/backfill-merchants.ts lib/transactions/__tests__/backfill.itest.ts
git commit -m "feat(backfill): type-aware recategorize + CSV-enrich for payee recovery"
```

---

## Task 9: Full verification + run against the real data

**Files:** none (verification only).

- [ ] **Step 1: Whole-suite unit tests**

Run: `npm test`
Expected: PASS (all unit tests, including the updated merchant/pipeline/mapping/roles/seed/learn tests).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck`
Run: `npm run lint`
Run: `npm run build`
Expected: all succeed.

- [ ] **Step 3: Integration suite**

Ensure local Supabase is running, then:
Run: `npm run test:integration`
Expected: PASS.

- [ ] **Step 4: Seed + backfill + enrich against the real exports**

With local Supabase running and the DB holding the user's imported data, find the account id (from the app or `select id, name from accounts;`), then run for each export (drops the preamble row automatically):

```bash
npm run backfill:merchants -- "C:/Users/Maciek/Downloads/historia_2026-05-31_08109025900000000141981663.csv" <ACCOUNT_ID>
npm run backfill:merchants -- "C:/Users/Maciek/Downloads/historia_2026-06-02_08109025900000000141981663.csv" <ACCOUNT_ID>
npm run backfill:merchants -- "C:/Users/Maciek/Downloads/historia_2026-06-02_62109025900000000156628467.csv" <SECOND_ACCOUNT_ID>
```

Expected console: non-zero `Seeded` on first run (0 on reruns — idempotent), `matched`/`updated` counts near the file's row count, and `recategorized > 0`.

- [ ] **Step 5: Eyeball the result**

In the app's Transactions view confirm: transfers show real names (`Julia Zakrzewska`, `Szymek`), card payments show brands (`ALDI`, `LIDL`, `BIEDRONKA`), and Groceries/Transport/Dining are populated rather than mostly uncategorized. Spot-check that any rows you'd previously corrected by hand kept their category (user corrections preserved).

- [ ] **Step 6: Final commit (if any verification-driven tweaks were needed)**

```bash
git add -A
git commit -m "test: verify extraction + categorization end-to-end"
```

---

## Self-review (completed by plan author)

**Spec coverage:** type-aware extraction (Tasks 1-2, 5) ✓; counterparty as first-class field + UI roles (Tasks 3, 7) ✓; seed dictionary → merchant_map (Task 4) ✓; note+sign AI + learning (Task 6) ✓; backfill in place + payee recovery (Task 8) ✓; preamble-row skip (Task 8 Step 3 slices row 1; the import UI already lets the user pick the start row) ✓; known gateway limitation documented (Task 4 seedRules header) ✓.

**Placeholder scan:** every code/test step contains complete code; commands have expected output. No TBD/TODO.

**Type consistency:** `classifyTransaction(title, counterparty)`, `extractMerchant(type, title, counterparty)`, `MappedFields.{title,counterparty,rawDescription}`, `TransactionDraft.txnType`, `seedMerchantRules`, `insertAiRuleIfAbsent`, `learnableRules`, `enrichFromCsv` are used identically wherever they appear. Dedup hash is built from `title` in both the pipeline (Task 5) and `enrichFromCsv` (Task 8), so existing rows match.

**Open risk to watch during execution:** the exact non-null columns required to insert a test `accounts` row (Task 8 Step 4) — mirror the existing `run.itest.ts` fixture. If `MB&SJ` etc. unexpectedly match a seed `contains` pattern, tighten that pattern; the seedRules test (Task 4) guards the known set.
