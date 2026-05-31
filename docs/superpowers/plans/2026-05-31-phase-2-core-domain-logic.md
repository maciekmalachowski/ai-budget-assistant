# AI Budget Assistant — Phase 2: Core Domain Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, credential-free TypeScript that turns a raw bank-CSV buffer into normalized, de-duplicated, rules-categorized transaction drafts — fully unit-tested, with no DB, AI, network, or secrets.

**Architecture:** Small, single-responsibility modules under `lib/`. Leaf utilities (money, dates, normalize, rules) have no dependencies on each other; CSV modules build on them; a `pipeline` orchestrates everything and captures per-row errors. Amounts are represented as **signed integer minor units** (e.g. grosze) to avoid floating-point drift. Everything is a pure function — no I/O except reading a `Buffer` passed in by the caller.

**Tech Stack:** TypeScript (strict), Vitest (already configured in Phase 1; `@/*` alias works in tests via `vite-tsconfig-paths`), `papaparse` (CSV), `iconv-lite` (Windows-1250 decode), Node `node:crypto` (hashing), Node global `TextDecoder` (UTF-8 validation).

> **Phase context:** Phase 2 of 7. Phase 1 (Foundations) is merged to `main`: Next.js 15 + TS strict + Tailwind v4 + Vitest, `@/*` → repo root, vitest `exclude` covers `**/node_modules/**` and `.worktrees/**`. Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` (§6 data model, §7 import pipeline, §8 categorization). This phase implements the *pure logic* behind §7 steps 3–6 and the rules half of §8; DB persistence and AI fallback come in Phases 3–4.

---

## Target File Structure (end of this phase)

```
lib/domain/types.ts                 # shared domain types (no runtime code)
lib/domain/money.ts                 # parseAmount, combineDebitCredit  → minor units
lib/domain/dates.ts                 # parseDate(raw, format) → ISO YYYY-MM-DD
lib/domain/normalize.ts             # normalizeMerchant, computeDedupHash
lib/domain/__tests__/money.test.ts
lib/domain/__tests__/dates.test.ts
lib/domain/__tests__/normalize.test.ts
lib/csv/parse.ts                    # detectEncoding, decodeBuffer, detectDelimiter, parseCsv(Buffer)
lib/csv/mapping.ts                  # applyMapping(row, mapping) → MappedFields
lib/csv/profile.ts                  # headerSignature(header[]) → sha256
lib/csv/__tests__/parse.test.ts
lib/csv/__tests__/mapping.test.ts
lib/csv/__tests__/profile.test.ts
lib/csv/__tests__/fixtures/mbank-sample.csv   # UTF-8, ';'-delimited sample
lib/categorize/rules.ts             # categorizeByRules(desc, merchant, rules) → categoryId|null
lib/categorize/__tests__/rules.test.ts
lib/import/pipeline.ts              # buildTransactionDrafts(...) → { drafts, errors }
lib/import/__tests__/pipeline.test.ts
```

**Conventions:** Tests live in a sibling `__tests__/` dir (matches Phase 1's `lib/__tests__/`). Run a single test file with `npx vitest run <path>`; run the whole suite with `npm test`. Every task ends with a commit; append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` to each commit message.

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install runtime + dev dependencies**

Run:
```bash
npm install papaparse@^5.4.1 iconv-lite@^0.6.3
npm install -D @types/papaparse@^5.3.15
```
Expected: completes with no `npm error` lines; `papaparse` and `iconv-lite` appear under `dependencies`, `@types/papaparse` under `devDependencies` in `package.json`.

- [ ] **Step 2: Verify the project still builds clean**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add papaparse, iconv-lite, @types/papaparse for CSV domain logic"
```

---

## Task 2: Shared domain types

**Files:**
- Create: `lib/domain/types.ts`

- [ ] **Step 1: Create `lib/domain/types.ts`**

```ts
/** Date layouts we support parsing from bank exports. */
export type DateFormat =
  | "DD.MM.YYYY"
  | "DD-MM-YYYY"
  | "YYYY-MM-DD"
  | "DD/MM/YYYY"
  | "MM/DD/YYYY";

/** Text encodings we decode CSV buffers from. */
export type SupportedEncoding = "utf-8" | "win1250";

/** How a transaction's category was decided. */
export type CategorySource = "rule" | "ai" | "user" | "uncategorized";

/** A parsed CSV row keyed by (trimmed) header name. */
export type RawRow = Record<string, string>;

/** How the signed amount is derived from the CSV. */
export type AmountMapping =
  | { mode: "signed"; amountColumn: string }
  | { mode: "debit_credit"; debitColumn: string; creditColumn: string };

/** Maps a specific bank's CSV columns onto our fields. */
export interface ColumnMapping {
  dateColumn: string;
  dateFormat: DateFormat;
  /** One or more columns joined (space-separated) into the description. */
  descriptionColumns: string[];
  amount: AmountMapping;
  decimalSep: "," | ".";
  /** Optional currency column; falls back to defaultCurrency when absent/empty. */
  currencyColumn?: string;
  defaultCurrency: string;
}

/** Normalized fields extracted from a single CSV row. */
export interface MappedFields {
  /** ISO date, "YYYY-MM-DD". */
  bookedAt: string;
  /** Signed integer minor units (negative = outflow, positive = inflow). */
  amountMinor: number;
  currency: string;
  rawDescription: string;
}

/** A learned/seeded categorization rule (merchant_map row). */
export interface MerchantRule {
  matchType: "exact" | "contains" | "regex";
  pattern: string;
  categoryId: string;
}

/** A ready-to-persist transaction (before DB insert / dedup against existing rows). */
export interface TransactionDraft {
  bookedAt: string;
  amountMinor: number;
  currency: string;
  rawDescription: string;
  merchant: string;
  dedupHash: string;
  categoryId: string | null;
  categorySource: CategorySource;
}

/** A row that failed to parse, reported without aborting the batch. */
export interface RowError {
  rowIndex: number;
  message: string;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/domain/types.ts
git commit -m "feat(domain): add shared types for CSV import and categorization"
```

---

## Task 3: Amount parsing (minor units)

**Files:**
- Test: `lib/domain/__tests__/money.test.ts`
- Create: `lib/domain/money.ts`

- [ ] **Step 1: Write the failing test**

`lib/domain/__tests__/money.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseAmount, combineDebitCredit } from "@/lib/domain/money";

describe("parseAmount", () => {
  it("parses negative comma-decimal amounts to signed minor units", () => {
    expect(parseAmount("-87,40", { decimalSep: "," })).toBe(-8740);
  });
  it("strips space and nbsp thousands separators", () => {
    expect(parseAmount("9 500,00", { decimalSep: "," })).toBe(950000);
    expect(parseAmount("1 234,56", { decimalSep: "," })).toBe(123456);
  });
  it("treats dot as thousands when comma is the decimal separator", () => {
    expect(parseAmount("1.234,56", { decimalSep: "," })).toBe(123456);
  });
  it("handles US style (dot decimal, comma thousands)", () => {
    expect(parseAmount("1,234.56", { decimalSep: "." })).toBe(123456);
  });
  it("parses explicit plus sign and parentheses-negatives", () => {
    expect(parseAmount("+43,00", { decimalSep: "," })).toBe(4300);
    expect(parseAmount("(12,00)", { decimalSep: "," })).toBe(-1200);
  });
  it("throws on unparseable input", () => {
    expect(() => parseAmount("abc", { decimalSep: "," })).toThrow();
    expect(() => parseAmount("", { decimalSep: "," })).toThrow();
  });
});

describe("combineDebitCredit", () => {
  it("makes debit negative and credit positive", () => {
    expect(combineDebitCredit("87,40", "", { decimalSep: "," })).toBe(-8740);
    expect(combineDebitCredit("", "9 500,00", { decimalSep: "," })).toBe(950000);
  });
  it("ignores a zero-filled unused side", () => {
    expect(combineDebitCredit("0,00", "9 500,00", { decimalSep: "," })).toBe(950000);
  });
  it("throws when both sides are empty or both non-zero", () => {
    expect(() => combineDebitCredit("", "", { decimalSep: "," })).toThrow();
    expect(() => combineDebitCredit("10,00", "5,00", { decimalSep: "," })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/domain/__tests__/money.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/money`.

- [ ] **Step 3: Create `lib/domain/money.ts`**

```ts
export interface AmountParseOptions {
  decimalSep: "," | ".";
  /** Minor-unit decimal places (default 2). */
  decimals?: number;
}

/** Parse a localized money string into signed integer minor units. */
export function parseAmount(raw: string, opts: AmountParseOptions): number {
  const decimals = opts.decimals ?? 2;
  let s = raw.trim();
  if (s === "") throw new Error("Empty amount");

  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Remove all whitespace (incl. non-breaking space) used as thousands separators.
  s = s.replace(/[\s ]/g, "");
  if (opts.decimalSep === ",") {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Unparseable amount: "${raw}"`);
  }
  const minor = Math.round(Number(s) * 10 ** decimals);
  return sign * minor;
}

/** Combine a bank's separate debit/credit columns into one signed minor-unit value. */
export function combineDebitCredit(
  debitRaw: string,
  creditRaw: string,
  opts: AmountParseOptions,
): number {
  const d = debitRaw.trim();
  const c = creditRaw.trim();
  const dv = d === "" ? 0 : parseAmount(d, opts);
  const cv = c === "" ? 0 : parseAmount(c, opts);
  if (dv === 0 && cv === 0) {
    throw new Error("Both debit and credit are empty or zero");
  }
  if (dv !== 0 && cv !== 0) {
    throw new Error("Both debit and credit are non-zero");
  }
  return dv !== 0 ? -Math.abs(dv) : Math.abs(cv);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/domain/__tests__/money.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/money.ts lib/domain/__tests__/money.test.ts
git commit -m "feat(domain): parse localized amounts to signed minor units"
```

---

## Task 4: Date parsing

**Files:**
- Test: `lib/domain/__tests__/dates.test.ts`
- Create: `lib/domain/dates.ts`

- [ ] **Step 1: Write the failing test**

`lib/domain/__tests__/dates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseDate } from "@/lib/domain/dates";

describe("parseDate", () => {
  it("parses each supported format to ISO YYYY-MM-DD", () => {
    expect(parseDate("12.05.2026", "DD.MM.YYYY")).toBe("2026-05-12");
    expect(parseDate("12-05-2026", "DD-MM-YYYY")).toBe("2026-05-12");
    expect(parseDate("2026-05-12", "YYYY-MM-DD")).toBe("2026-05-12");
    expect(parseDate("12/05/2026", "DD/MM/YYYY")).toBe("2026-05-12");
    expect(parseDate("05/12/2026", "MM/DD/YYYY")).toBe("2026-05-12");
  });
  it("trims surrounding whitespace", () => {
    expect(parseDate("  12.05.2026 ", "DD.MM.YYYY")).toBe("2026-05-12");
  });
  it("throws when the value does not match the format", () => {
    expect(() => parseDate("2026-05-12", "DD.MM.YYYY")).toThrow();
  });
  it("throws on impossible dates", () => {
    expect(() => parseDate("32.13.2026", "DD.MM.YYYY")).toThrow();
    expect(() => parseDate("29.02.2027", "DD.MM.YYYY")).toThrow(); // 2027 not leap
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/domain/__tests__/dates.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/dates`.

- [ ] **Step 3: Create `lib/domain/dates.ts`**

```ts
import type { DateFormat } from "@/lib/domain/types";

const PATTERNS: Record<DateFormat, RegExp> = {
  "DD.MM.YYYY": /^(\d{2})\.(\d{2})\.(\d{4})$/,
  "DD-MM-YYYY": /^(\d{2})-(\d{2})-(\d{4})$/,
  "YYYY-MM-DD": /^(\d{4})-(\d{2})-(\d{2})$/,
  "DD/MM/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
  "MM/DD/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
};

/** Parse a date string in the given layout into ISO "YYYY-MM-DD". Throws if invalid. */
export function parseDate(raw: string, format: DateFormat): string {
  const m = PATTERNS[format].exec(raw.trim());
  if (!m) throw new Error(`Date "${raw}" does not match format ${format}`);

  let year: number;
  let month: number;
  let day: number;
  if (format === "YYYY-MM-DD") {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if (format === "MM/DD/YYYY") {
    month = Number(m[1]);
    day = Number(m[2]);
    year = Number(m[3]);
  } else {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  }

  if (month < 1 || month > 12) throw new Error(`Invalid month in "${raw}"`);
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) throw new Error(`Invalid day in "${raw}"`);

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/domain/__tests__/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/dates.ts lib/domain/__tests__/dates.test.ts
git commit -m "feat(domain): parse multiple bank date formats to ISO"
```

---

## Task 5: Merchant normalization & dedup hash

**Files:**
- Test: `lib/domain/__tests__/normalize.test.ts`
- Create: `lib/domain/normalize.ts`

- [ ] **Step 1: Write the failing test**

`lib/domain/__tests__/normalize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeMerchant, computeDedupHash } from "@/lib/domain/normalize";

describe("normalizeMerchant", () => {
  it("uppercases, collapses whitespace, and drops long digit tokens", () => {
    expect(normalizeMerchant("Biedronka 1234 Warszawa")).toBe("BIEDRONKA WARSZAWA");
    expect(normalizeMerchant("  uber   *trip ")).toBe("UBER *TRIP");
  });
  it("keeps short digit tokens (they may be meaningful)", () => {
    expect(normalizeMerchant("Sklep 12")).toBe("SKLEP 12");
  });
});

describe("computeDedupHash", () => {
  const base = {
    accountId: "acc-1",
    bookedAt: "2026-05-12",
    amountMinor: -8740,
    rawDescription: "BIEDRONKA 1234 WARSZAWA",
    occurrence: 0,
  };

  it("is stable for identical input", () => {
    expect(computeDedupHash(base)).toBe(computeDedupHash({ ...base }));
  });
  it("ignores case/whitespace differences in the description", () => {
    expect(computeDedupHash(base)).toBe(
      computeDedupHash({ ...base, rawDescription: "  biedronka 1234   warszawa " }),
    );
  });
  it("differs when the occurrence index differs", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, occurrence: 1 }));
  });
  it("differs when the amount differs", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, amountMinor: -8741 }));
  });
  it("returns a 64-char hex sha256 digest", () => {
    expect(computeDedupHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/domain/__tests__/normalize.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/normalize`.

- [ ] **Step 3: Create `lib/domain/normalize.ts`**

```ts
import { createHash } from "node:crypto";

/** Derive a clean, display-friendly merchant name from a raw bank description. */
export function normalizeMerchant(rawDescription: string): string {
  return rawDescription
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((tok) => tok !== "" && !/^\d{4,}$/.test(tok))
    .join(" ")
    .trim();
}

/** Whitespace/case-insensitive canonical form of a description, for stable hashing. */
function canonicalizeForHash(rawDescription: string): string {
  return rawDescription.toUpperCase().replace(/\s+/g, " ").trim();
}

export interface DedupHashInput {
  accountId: string;
  bookedAt: string;
  amountMinor: number;
  rawDescription: string;
  /** 0-based index among otherwise-identical rows in the same import batch. */
  occurrence: number;
}

/** Deterministic per-account dedup key: hash(account|date|amount|canonicalDesc|occurrence). */
export function computeDedupHash(input: DedupHashInput): string {
  const canonical = [
    input.accountId,
    input.bookedAt,
    String(input.amountMinor),
    canonicalizeForHash(input.rawDescription),
    String(input.occurrence),
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/domain/__tests__/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/normalize.ts lib/domain/__tests__/normalize.test.ts
git commit -m "feat(domain): merchant normalization and stable dedup hashing"
```

---

## Task 6: Rules-based categorization

**Files:**
- Test: `lib/categorize/__tests__/rules.test.ts`
- Create: `lib/categorize/rules.ts`

- [ ] **Step 1: Write the failing test**

`lib/categorize/__tests__/rules.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { categorizeByRules } from "@/lib/categorize/rules";
import type { MerchantRule } from "@/lib/domain/types";

const rules: MerchantRule[] = [
  { matchType: "contains", pattern: "BIEDRONKA", categoryId: "groceries" },
  { matchType: "regex", pattern: "^UBER", categoryId: "transport" },
  { matchType: "exact", pattern: "NETFLIX.COM", categoryId: "subs" },
];

describe("categorizeByRules", () => {
  it("matches a 'contains' rule against the description", () => {
    expect(categorizeByRules("BIEDRONKA 1234 WARSZAWA", "BIEDRONKA WARSZAWA", rules)).toBe("groceries");
  });
  it("matches a 'regex' rule (case-insensitive)", () => {
    expect(categorizeByRules("uber *trip help.uber.com", "UBER *TRIP", rules)).toBe("transport");
  });
  it("matches an 'exact' rule against the full description or merchant", () => {
    expect(categorizeByRules("NETFLIX.COM", "NETFLIX.COM", rules)).toBe("subs");
  });
  it("returns null when nothing matches", () => {
    expect(categorizeByRules("SALARY ACME SP Z OO", "SALARY ACME SP Z OO", rules)).toBeNull();
  });
  it("returns the first matching rule's category (order wins)", () => {
    const ordered: MerchantRule[] = [
      { matchType: "contains", pattern: "SHOP", categoryId: "first" },
      { matchType: "contains", pattern: "SHOP", categoryId: "second" },
    ];
    expect(categorizeByRules("BIG SHOP", "BIG SHOP", ordered)).toBe("first");
  });
  it("throws on an invalid regex pattern", () => {
    const bad: MerchantRule[] = [{ matchType: "regex", pattern: "[", categoryId: "x" }];
    expect(() => categorizeByRules("anything", "ANYTHING", bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/categorize/__tests__/rules.test.ts`
Expected: FAIL — cannot resolve `@/lib/categorize/rules`.

- [ ] **Step 3: Create `lib/categorize/rules.ts`**

```ts
import type { MerchantRule } from "@/lib/domain/types";

/**
 * Return the categoryId of the first matching rule, or null if none match.
 * Matching is case-insensitive. Throws if a regex rule has an invalid pattern.
 */
export function categorizeByRules(
  rawDescription: string,
  merchant: string,
  rules: MerchantRule[],
): string | null {
  const descUpper = rawDescription.toUpperCase();
  const merchantUpper = merchant.toUpperCase();
  const haystack = `${merchantUpper} ${descUpper}`;

  for (const rule of rules) {
    if (rule.matchType === "exact") {
      const p = rule.pattern.toUpperCase();
      if (descUpper === p || merchantUpper === p) return rule.categoryId;
    } else if (rule.matchType === "contains") {
      if (haystack.includes(rule.pattern.toUpperCase())) return rule.categoryId;
    } else {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, "i");
      } catch {
        throw new Error(`Invalid regex in categorization rule: "${rule.pattern}"`);
      }
      if (re.test(rawDescription) || re.test(merchant)) return rule.categoryId;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/categorize/__tests__/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/categorize/rules.ts lib/categorize/__tests__/rules.test.ts
git commit -m "feat(categorize): rules engine (exact/contains/regex) over merchant_map"
```

---

## Task 7: CSV decode & parse

**Files:**
- Create: `lib/csv/__tests__/fixtures/mbank-sample.csv`
- Test: `lib/csv/__tests__/parse.test.ts`
- Create: `lib/csv/parse.ts`

- [ ] **Step 1: Create the fixture `lib/csv/__tests__/fixtures/mbank-sample.csv`** (UTF-8, `;`-delimited)

```text
Data operacji;Opis operacji;Kwota;Saldo po operacji
12.05.2026;BIEDRONKA 1234 WARSZAWA;-87,40;3 912,55
12.05.2026;UBER *TRIP HELP.UBER.COM;-24,00;3 888,55
11.05.2026;SALARY ACME SP Z OO;+9 500,00;3 912,55
10.05.2026;PMNT NETFLIX.COM;-43,00;3 845,55
```

- [ ] **Step 2: Write the failing test**

`lib/csv/__tests__/parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import iconv from "iconv-lite";
import {
  detectEncoding,
  decodeBuffer,
  detectDelimiter,
  parseCsv,
  parseCsvBuffer,
} from "@/lib/csv/parse";

const sampleBuf = readFileSync(new URL("./fixtures/mbank-sample.csv", import.meta.url));

describe("detectEncoding", () => {
  it("detects UTF-8 for the sample fixture", () => {
    expect(detectEncoding(sampleBuf)).toBe("utf-8");
  });
  it("falls back to win1250 for bytes that are invalid UTF-8", () => {
    const buf = iconv.encode("PŁATNOŚĆ ŻABKA", "win1250");
    expect(detectEncoding(buf)).toBe("win1250");
  });
});

describe("decodeBuffer", () => {
  it("round-trips Windows-1250 Polish characters", () => {
    const buf = iconv.encode("PŁATNOŚĆ ŻABKA", "win1250");
    expect(decodeBuffer(buf, "win1250")).toBe("PŁATNOŚĆ ŻABKA");
  });
});

describe("detectDelimiter", () => {
  it("picks ';' for the sample header", () => {
    expect(detectDelimiter(decodeBuffer(sampleBuf))).toBe(";");
  });
  it("picks ',' for a comma header", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });
});

describe("parseCsvBuffer", () => {
  it("parses the sample into header + rows", () => {
    const { header, rows, encoding, delimiter } = parseCsvBuffer(sampleBuf);
    expect(encoding).toBe("utf-8");
    expect(delimiter).toBe(";");
    expect(header).toEqual(["Data operacji", "Opis operacji", "Kwota", "Saldo po operacji"]);
    expect(rows).toHaveLength(4);
    expect(rows[0]["Opis operacji"]).toBe("BIEDRONKA 1234 WARSZAWA");
    expect(rows[0]["Kwota"]).toBe("-87,40");
  });
});

describe("parseCsv", () => {
  it("trims header names", () => {
    const { header } = parseCsv(" a ;b\n1;2", ";");
    expect(header).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run lib/csv/__tests__/parse.test.ts`
Expected: FAIL — cannot resolve `@/lib/csv/parse`.

- [ ] **Step 4: Create `lib/csv/parse.ts`**

```ts
import Papa from "papaparse";
import iconv from "iconv-lite";
import type { RawRow, SupportedEncoding } from "@/lib/domain/types";

/** Guess the encoding: UTF-8 if it has a BOM or decodes cleanly, else Windows-1250. */
export function detectEncoding(buf: Buffer): SupportedEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return "utf-8";
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return "utf-8";
  } catch {
    return "win1250";
  }
}

/** Decode a CSV buffer to a string, detecting the encoding when not given. */
export function decodeBuffer(buf: Buffer, encoding?: SupportedEncoding): string {
  const enc = encoding ?? detectEncoding(buf);
  if (enc === "utf-8") {
    const text = buf.toString("utf-8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }
  return iconv.decode(buf, "win1250");
}

const DELIMITERS = [";", ",", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** Pick the delimiter that appears most often in the first (header) line. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best: Delimiter = ",";
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export interface ParsedCsv {
  header: string[];
  rows: RawRow[];
}

/** Parse already-decoded CSV text with a known delimiter into header + keyed rows. */
export function parseCsv(text: string, delimiter: string): ParsedCsv {
  const result = Papa.parse<RawRow>(text, {
    header: true,
    delimiter,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const header = result.meta.fields ?? [];
  const rows = (result.data ?? []).filter((r) => Object.keys(r).length > 0);
  return { header, rows };
}

export interface ParseCsvBufferOptions {
  encoding?: SupportedEncoding;
  delimiter?: Delimiter;
}

export interface ParseCsvBufferResult extends ParsedCsv {
  encoding: SupportedEncoding;
  delimiter: Delimiter;
}

/** Full pipeline: detect/decode + detect delimiter + parse. */
export function parseCsvBuffer(buf: Buffer, opts: ParseCsvBufferOptions = {}): ParseCsvBufferResult {
  const encoding = opts.encoding ?? detectEncoding(buf);
  const text = decodeBuffer(buf, encoding);
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const { header, rows } = parseCsv(text, delimiter);
  return { header, rows, encoding, delimiter };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/csv/__tests__/parse.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/csv/parse.ts lib/csv/__tests__/parse.test.ts lib/csv/__tests__/fixtures/mbank-sample.csv
git commit -m "feat(csv): encoding/delimiter detection and CSV parsing"
```

---

## Task 8: Column mapping

**Files:**
- Test: `lib/csv/__tests__/mapping.test.ts`
- Create: `lib/csv/mapping.ts`

- [ ] **Step 1: Write the failing test**

`lib/csv/__tests__/mapping.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { applyMapping } from "@/lib/csv/mapping";
import type { ColumnMapping, RawRow } from "@/lib/domain/types";

const signedMapping: ColumnMapping = {
  dateColumn: "Data operacji",
  dateFormat: "DD.MM.YYYY",
  descriptionColumns: ["Opis operacji"],
  amount: { mode: "signed", amountColumn: "Kwota" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

describe("applyMapping (signed)", () => {
  it("maps a row to normalized fields", () => {
    const row: RawRow = {
      "Data operacji": "12.05.2026",
      "Opis operacji": "BIEDRONKA 1234 WARSZAWA",
      "Kwota": "-87,40",
      "Saldo po operacji": "3 912,55",
    };
    expect(applyMapping(row, signedMapping)).toEqual({
      bookedAt: "2026-05-12",
      amountMinor: -8740,
      currency: "PLN",
      rawDescription: "BIEDRONKA 1234 WARSZAWA",
    });
  });
  it("throws when a mapped column is missing", () => {
    const row: RawRow = { "Opis operacji": "X", "Kwota": "-1,00" };
    expect(() => applyMapping(row, signedMapping)).toThrow(/Data operacji/);
  });
});

describe("applyMapping (debit/credit + multi-column description + currency)", () => {
  const mapping: ColumnMapping = {
    dateColumn: "Date",
    dateFormat: "YYYY-MM-DD",
    descriptionColumns: ["Payee", "Memo"],
    amount: { mode: "debit_credit", debitColumn: "Debit", creditColumn: "Credit" },
    decimalSep: ".",
    currencyColumn: "Currency",
    defaultCurrency: "PLN",
  };
  it("combines debit/credit, joins descriptions, and reads currency", () => {
    const row: RawRow = {
      Date: "2026-05-11",
      Payee: "ACME",
      Memo: "Salary",
      Debit: "",
      Credit: "9,500.00",
      Currency: "EUR",
    };
    expect(applyMapping(row, mapping)).toEqual({
      bookedAt: "2026-05-11",
      amountMinor: 950000,
      currency: "EUR",
      rawDescription: "ACME Salary",
    });
  });
  it("falls back to defaultCurrency when the currency cell is empty", () => {
    const row: RawRow = { Date: "2026-05-11", Payee: "ACME", Memo: "", Debit: "10.00", Credit: "", Currency: "" };
    expect(applyMapping(row, mapping).currency).toBe("PLN");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/csv/__tests__/mapping.test.ts`
Expected: FAIL — cannot resolve `@/lib/csv/mapping`.

- [ ] **Step 3: Create `lib/csv/mapping.ts`**

```ts
import type { ColumnMapping, MappedFields, RawRow } from "@/lib/domain/types";
import { parseDate } from "@/lib/domain/dates";
import { parseAmount, combineDebitCredit } from "@/lib/domain/money";

function requireColumn(row: RawRow, col: string): string {
  if (!(col in row)) throw new Error(`Missing column "${col}"`);
  return row[col] ?? "";
}

/** Turn one raw CSV row into normalized fields using a bank's column mapping. */
export function applyMapping(row: RawRow, mapping: ColumnMapping): MappedFields {
  const bookedAt = parseDate(requireColumn(row, mapping.dateColumn), mapping.dateFormat);

  let amountMinor: number;
  if (mapping.amount.mode === "signed") {
    amountMinor = parseAmount(requireColumn(row, mapping.amount.amountColumn), {
      decimalSep: mapping.decimalSep,
    });
  } else {
    amountMinor = combineDebitCredit(
      requireColumn(row, mapping.amount.debitColumn),
      requireColumn(row, mapping.amount.creditColumn),
      { decimalSep: mapping.decimalSep },
    );
  }

  const rawDescription = mapping.descriptionColumns
    .map((c) => requireColumn(row, c).trim())
    .filter((v) => v !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const currency = mapping.currencyColumn
    ? requireColumn(row, mapping.currencyColumn).trim() || mapping.defaultCurrency
    : mapping.defaultCurrency;

  return { bookedAt, amountMinor, currency, rawDescription };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/csv/__tests__/mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/mapping.ts lib/csv/__tests__/mapping.test.ts
git commit -m "feat(csv): apply column mapping to raw rows"
```

---

## Task 9: Header fingerprint (for import profiles)

**Files:**
- Test: `lib/csv/__tests__/profile.test.ts`
- Create: `lib/csv/profile.ts`

- [ ] **Step 1: Write the failing test**

`lib/csv/__tests__/profile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { headerSignature } from "@/lib/csv/profile";

describe("headerSignature", () => {
  it("is stable across case and surrounding whitespace", () => {
    const a = headerSignature(["Data operacji", "Opis operacji", "Kwota"]);
    const b = headerSignature([" data operacji ", "OPIS OPERACJI", "kwota"]);
    expect(a).toBe(b);
  });
  it("differs for different headers (including order)", () => {
    const a = headerSignature(["a", "b", "c"]);
    expect(a).not.toBe(headerSignature(["a", "b"]));
    expect(a).not.toBe(headerSignature(["c", "b", "a"]));
  });
  it("returns a 64-char hex sha256 digest", () => {
    expect(headerSignature(["a", "b"])).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/csv/__tests__/profile.test.ts`
Expected: FAIL — cannot resolve `@/lib/csv/profile`.

- [ ] **Step 3: Create `lib/csv/profile.ts`**

```ts
import { createHash } from "node:crypto";

/**
 * Stable fingerprint of a CSV header row, used to recognize a bank's layout
 * and restore its saved import profile. Order-sensitive; case/whitespace-insensitive.
 */
export function headerSignature(header: string[]): string {
  const canonical = header.map((h) => h.trim().toLowerCase()).join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/csv/__tests__/profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/profile.ts lib/csv/__tests__/profile.test.ts
git commit -m "feat(csv): header fingerprint for import-profile matching"
```

---

## Task 10: Import pipeline (orchestration + per-row errors)

**Files:**
- Test: `lib/import/__tests__/pipeline.test.ts`
- Create: `lib/import/pipeline.ts`

- [ ] **Step 1: Write the failing test**

`lib/import/__tests__/pipeline.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildTransactionDrafts } from "@/lib/import/pipeline";
import { parseCsvBuffer } from "@/lib/csv/parse";
import type { ColumnMapping, MerchantRule } from "@/lib/domain/types";

const mapping: ColumnMapping = {
  dateColumn: "Data operacji",
  dateFormat: "DD.MM.YYYY",
  descriptionColumns: ["Opis operacji"],
  amount: { mode: "signed", amountColumn: "Kwota" },
  decimalSep: ",",
  defaultCurrency: "PLN",
};

const rules: MerchantRule[] = [
  { matchType: "contains", pattern: "BIEDRONKA", categoryId: "groceries" },
  { matchType: "regex", pattern: "UBER", categoryId: "transport" },
  { matchType: "contains", pattern: "NETFLIX", categoryId: "subs" },
];

describe("buildTransactionDrafts", () => {
  it("builds drafts from the parsed sample fixture and applies rules", () => {
    const { rows } = parseCsvBuffer(
      readFileSync(new URL("../../csv/__tests__/fixtures/mbank-sample.csv", import.meta.url)),
    );
    const { drafts, errors } = buildTransactionDrafts({ accountId: "acc-1", rows, mapping, rules });

    expect(errors).toEqual([]);
    expect(drafts).toHaveLength(4);

    expect(drafts[0]).toMatchObject({
      bookedAt: "2026-05-12",
      amountMinor: -8740,
      currency: "PLN",
      merchant: "BIEDRONKA WARSZAWA",
      categoryId: "groceries",
      categorySource: "rule",
    });
    expect(drafts[0].dedupHash).toMatch(/^[0-9a-f]{64}$/);

    // SALARY row matches no rule.
    expect(drafts[2]).toMatchObject({ amountMinor: 950000, categoryId: null, categorySource: "uncategorized" });
    // UBER + NETFLIX categorized.
    expect(drafts[1].categoryId).toBe("transport");
    expect(drafts[3].categoryId).toBe("subs");
  });

  it("captures per-row errors without aborting the batch", () => {
    const rows = [
      { "Data operacji": "12.05.2026", "Opis operacji": "OK SHOP", "Kwota": "-10,00" },
      { "Data operacji": "BAD", "Opis operacji": "BROKEN", "Kwota": "-5,00" },
      { "Data operacji": "13.05.2026", "Opis operacji": "FINE", "Kwota": "-1,00" },
    ];
    const { drafts, errors } = buildTransactionDrafts({ accountId: "acc-1", rows, mapping, rules });
    expect(drafts).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowIndex).toBe(1);
  });

  it("gives identical same-day rows distinct hashes via occurrence index", () => {
    const dup = { "Data operacji": "12.05.2026", "Opis operacji": "KIOSK", "Kwota": "-3,00" };
    const { drafts } = buildTransactionDrafts({ accountId: "acc-1", rows: [dup, { ...dup }], mapping, rules });
    expect(drafts).toHaveLength(2);
    expect(drafts[0].dedupHash).not.toBe(drafts[1].dedupHash);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/import/__tests__/pipeline.test.ts`
Expected: FAIL — cannot resolve `@/lib/import/pipeline`.

- [ ] **Step 3: Create `lib/import/pipeline.ts`**

```ts
import type {
  ColumnMapping,
  MerchantRule,
  RawRow,
  RowError,
  TransactionDraft,
} from "@/lib/domain/types";
import { applyMapping } from "@/lib/csv/mapping";
import { normalizeMerchant, computeDedupHash } from "@/lib/domain/normalize";
import { categorizeByRules } from "@/lib/categorize/rules";

export interface BuildDraftsInput {
  accountId: string;
  rows: RawRow[];
  mapping: ColumnMapping;
  rules: MerchantRule[];
}

export interface BuildDraftsResult {
  drafts: TransactionDraft[];
  errors: RowError[];
}

function canonicalDesc(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Turn parsed CSV rows into ready-to-persist transaction drafts:
 * map → normalize → assign dedup hash (with same-batch occurrence index) → apply rules.
 * Rows that fail to parse are collected in `errors` without aborting the batch.
 */
export function buildTransactionDrafts(input: BuildDraftsInput): BuildDraftsResult {
  const drafts: TransactionDraft[] = [];
  const errors: RowError[] = [];
  const occurrenceCounts = new Map<string, number>();

  input.rows.forEach((row, rowIndex) => {
    try {
      const fields = applyMapping(row, input.mapping);
      const merchant = normalizeMerchant(fields.rawDescription);

      const baseKey = [
        input.accountId,
        fields.bookedAt,
        fields.amountMinor,
        canonicalDesc(fields.rawDescription),
      ].join("|");
      const occurrence = occurrenceCounts.get(baseKey) ?? 0;
      occurrenceCounts.set(baseKey, occurrence + 1);

      const dedupHash = computeDedupHash({
        accountId: input.accountId,
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        rawDescription: fields.rawDescription,
        occurrence,
      });

      const categoryId = categorizeByRules(fields.rawDescription, merchant, input.rules);

      drafts.push({
        bookedAt: fields.bookedAt,
        amountMinor: fields.amountMinor,
        currency: fields.currency,
        rawDescription: fields.rawDescription,
        merchant,
        dedupHash,
        categoryId,
        categorySource: categoryId ? "rule" : "uncategorized",
      });
    } catch (err) {
      errors.push({ rowIndex, message: err instanceof Error ? err.message : String(err) });
    }
  });

  return { drafts, errors };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/import/__tests__/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the FULL suite + typecheck + lint + build**

Run each and confirm:
```bash
npm run typecheck   # no output, exit 0
npm test            # all Phase 1 + Phase 2 tests pass
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"
```

- [ ] **Step 6: Commit**

```bash
git add lib/import/pipeline.ts lib/import/__tests__/pipeline.test.ts
git commit -m "feat(import): orchestrate CSV rows into categorized transaction drafts"
```

---

## Done when

- `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` all pass.
- Given a bank CSV `Buffer`, a `ColumnMapping`, and a set of `MerchantRule`s, `buildTransactionDrafts` returns normalized, de-duplicatable, rules-categorized `TransactionDraft[]` plus a `RowError[]` for any unparseable rows — with zero DB/AI/network/secret dependencies.

**Next:** Phase 3 — Data model & local Supabase (migrations for the 8 tables + seed categories + RLS, generated types, repository layer, integration tests), which will persist these drafts and dedup them against existing rows.
