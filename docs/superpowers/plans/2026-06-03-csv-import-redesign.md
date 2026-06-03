# CSV Import Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header-name-based CSV import with a position-based, headerless importer that auto-detects where transactions start (skipping account-info preamble lines) and lets the user confirm everything in an editable preview grid.

**Architecture:** Parse files headerless into a padded string matrix with synthetic column keys (`Column 1…N`), so the existing map→normalize→dedup→categorize→insert pipeline runs unchanged. A read-only `/api/import/preview` endpoint auto-guesses the column mapping + start row and returns a sample; the editable preview grid confirms it; `/api/import` re-parses, drops the preamble, runs the pipeline, and remembers the layout (keyed by column-count + delimiter). All inference and UI↔mapping translation live in pure, unit-tested modules.

**Tech Stack:** Next.js 15 (App Router) route handlers, TypeScript strict, Tailwind v4 + shadcn-style components, Papaparse, Vitest (`npm test`), Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-03-csv-import-redesign-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `lib/csv/parse.ts` | Decode/parse CSV. Add headerless matrix parsing + synthetic column keys. | Modify (add functions) |
| `lib/csv/profile.ts` | Layout fingerprints. Add positional `layoutSignature`. | Modify (add function) |
| `lib/csv/roles.ts` | Pure translation between per-column UI roles and `ColumnMapping`. | **Create** |
| `lib/csv/detect.ts` | Pure heuristics: guess a mapping, detect the transaction-start row. | **Create** |
| `app/api/import/preview/route.ts` | Read-only preview: parse + guess + sample. No writes. | **Create** |
| `app/api/import/route.ts` | Commit: parse headerless, drop preamble, run pipeline, save layout. | Modify (rewrite handler) |
| `components/import/import-dropzone.tsx` | Drag-and-drop / click file picker with type+size guard. | **Create** |
| `components/import/import-preview.tsx` | Editable preview grid (column roles, start-row picker, controls). | **Create** |
| `components/import/import-wizard.tsx` | Orchestrate `upload → preview → done` + the two fetches. | Modify (rewrite) |
| `components/import/column-mapping-form.tsx` | Old abstract mapping form. | **Delete** (absorbed by the grid) |
| `lib/csv/__tests__/parse.test.ts` | Add headerless parse tests. | Modify |
| `lib/csv/__tests__/profile.test.ts` | Add `layoutSignature` test. | Modify |
| `lib/csv/__tests__/roles.test.ts` | Tests for `buildMapping` / `mappingToRoles`. | **Create** |
| `lib/csv/__tests__/detect.test.ts` | Tests for guessing + start-row detection (inline real-data matrices). | **Create** |

**Testing posture:** All inference and translation logic is pure and TDD'd (Tasks 1–4). The route handlers (Tasks 5–6) and React components (Tasks 7–9) follow the repo's existing pattern — the current `/api/import` route has no unit test — so they are kept thin (delegating to tested pure functions) and verified by `npm run typecheck` + `npm run lint` + the manual checklist in Task 10. No DB credentials are needed for any test in this plan; everything stays in the fast `npm test` suite.

---

## Task 1: Headerless matrix parsing (`lib/csv/parse.ts`)

**Files:**
- Modify: `lib/csv/parse.ts` (append new functions; do not change existing ones)
- Test: `lib/csv/__tests__/parse.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `lib/csv/__tests__/parse.test.ts`. Also add the new symbols to the existing import from `@/lib/csv/parse` at the top of the file (`columnKey, columnIndex, parseCsvMatrix, matrixToRawRows`):

```ts
import {
  detectEncoding,
  decodeBuffer,
  detectDelimiter,
  parseCsv,
  parseCsvBuffer,
  columnKey,
  columnIndex,
  parseCsvMatrix,
  matrixToRawRows,
} from "@/lib/csv/parse";

describe("columnKey / columnIndex", () => {
  it("round-trips a 0-based index to a synthetic key", () => {
    expect(columnKey(0)).toBe("Column 1");
    expect(columnKey(5)).toBe("Column 6");
    expect(columnIndex("Column 1")).toBe(0);
    expect(columnIndex("Column 6")).toBe(5);
  });
  it("returns -1 for non-synthetic keys", () => {
    expect(columnIndex("Kwota")).toBe(-1);
  });
});

describe("parseCsvMatrix", () => {
  it("parses headerless rows into a matrix padded to the max column count", () => {
    const { columns, rows } = parseCsvMatrix("a,b,c\n1,2\n", ",");
    expect(columns).toBe(3);
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", ""],
    ]);
  });
  it("keeps quoted values and skips blank lines", () => {
    const { rows } = parseCsvMatrix('31-05-2026,"37,40"\n\n', ",");
    expect(rows).toEqual([["31-05-2026", "37,40"]]);
  });
});

describe("matrixToRawRows", () => {
  it("keys each cell by its synthetic column", () => {
    expect(matrixToRawRows([["x", "y"]], 2)).toEqual([{ "Column 1": "x", "Column 2": "y" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- parse`
Expected: FAIL — `columnKey`/`parseCsvMatrix`/`matrixToRawRows` are not exported.

- [ ] **Step 3: Implement the headerless helpers**

Append to `lib/csv/parse.ts` (the file already imports `RawRow` and `SupportedEncoding` from `@/lib/domain/types`):

```ts
/** Stable synthetic key for the Nth (0-based) column of a headerless file. */
export function columnKey(index: number): string {
  return `Column ${index + 1}`;
}

/** Inverse of columnKey: "Column 6" → 5; -1 when the key is not synthetic. */
export function columnIndex(key: string): number {
  const m = /^Column (\d+)$/.exec(key);
  return m ? Number(m[1]) - 1 : -1;
}

export interface CsvMatrix {
  /** Max column count across all rows. */
  columns: number;
  /** Every row padded to `columns` cells (missing cells become ""). */
  rows: string[][];
}

/** Parse decoded CSV text with no header row into a padded matrix of raw string cells. */
export function parseCsvMatrix(text: string, delimiter: string): CsvMatrix {
  const result = Papa.parse<string[]>(text, {
    header: false,
    delimiter,
    skipEmptyLines: "greedy",
  });
  const data = (result.data ?? []).filter((r): r is string[] => Array.isArray(r));
  const columns = data.reduce((max, r) => Math.max(max, r.length), 0);
  const rows = data.map((r) => Array.from({ length: columns }, (_, i) => r[i] ?? ""));
  return { columns, rows };
}

export interface ParseMatrixResult extends CsvMatrix {
  encoding: SupportedEncoding;
  delimiter: Delimiter;
}

/** Full headerless pipeline: detect/decode + detect delimiter + parse into a matrix. */
export function parseCsvMatrixBuffer(buf: Buffer, opts: ParseCsvBufferOptions = {}): ParseMatrixResult {
  const encoding = opts.encoding ?? detectEncoding(buf);
  const text = decodeBuffer(buf, encoding);
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const { columns, rows } = parseCsvMatrix(text, delimiter);
  return { columns, rows, encoding, delimiter };
}

/** Convert a (sliced) matrix into RawRow objects keyed by synthetic column keys. */
export function matrixToRawRows(rows: string[][], columns: number): RawRow[] {
  return rows.map((cells) => {
    const row: RawRow = {};
    for (let i = 0; i < columns; i++) row[columnKey(i)] = cells[i] ?? "";
    return row;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- parse`
Expected: PASS (existing `parseCsvBuffer`/`parseCsv` tests still pass; new ones pass).

- [ ] **Step 5: Commit**

```bash
git add lib/csv/parse.ts lib/csv/__tests__/parse.test.ts
git commit -m "feat(csv): headerless matrix parsing + synthetic column keys"
```

---

## Task 2: Positional layout signature (`lib/csv/profile.ts`)

**Files:**
- Modify: `lib/csv/profile.ts`
- Test: `lib/csv/__tests__/profile.test.ts`

- [ ] **Step 1: Write the failing test**

In `lib/csv/__tests__/profile.test.ts`, change the import line to include `layoutSignature` and append a describe block:

```ts
import { headerSignature, layoutSignature } from "@/lib/csv/profile";

describe("layoutSignature", () => {
  it("is stable for the same column count + delimiter", () => {
    expect(layoutSignature(9, ",")).toBe(layoutSignature(9, ","));
  });
  it("differs when column count or delimiter differs", () => {
    expect(layoutSignature(9, ",")).not.toBe(layoutSignature(8, ","));
    expect(layoutSignature(9, ",")).not.toBe(layoutSignature(9, ";"));
  });
  it("returns a 64-char hex sha256 digest", () => {
    expect(layoutSignature(9, ",")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- profile`
Expected: FAIL — `layoutSignature` is not exported.

- [ ] **Step 3: Implement the function**

Append to `lib/csv/profile.ts` (the file already imports `createHash` from `node:crypto`):

```ts
/**
 * Stable fingerprint of a headerless layout (column count + delimiter). Lets a
 * bank's positional mapping be remembered across exports that have no header row.
 */
export function layoutSignature(columns: number, delimiter: string): string {
  return createHash("sha256").update(`${columns}|${delimiter}`, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- profile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/profile.ts lib/csv/__tests__/profile.test.ts
git commit -m "feat(csv): positional layoutSignature for headerless profiles"
```

---

## Task 3: Role ↔ mapping translation (`lib/csv/roles.ts`)

**Files:**
- Create: `lib/csv/roles.ts`
- Test: `lib/csv/__tests__/roles.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/csv/__tests__/roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMapping, mappingToRoles } from "@/lib/csv/roles";
import type { ColumnMapping } from "@/lib/domain/types";

const base = { dateFormat: "DD-MM-YYYY" as const, decimalSep: "," as const, defaultCurrency: "PLN" };

describe("buildMapping", () => {
  it("builds a signed mapping from role assignments", () => {
    const mapping = buildMapping({
      ...base,
      roles: { 0: "date", 2: "description", 3: "description", 5: "amount" },
    });
    expect(mapping).toEqual({
      dateColumn: "Column 1",
      dateFormat: "DD-MM-YYYY",
      descriptionColumns: ["Column 3", "Column 4"],
      amount: { mode: "signed", amountColumn: "Column 6" },
      decimalSep: ",",
      currencyColumn: undefined,
      defaultCurrency: "PLN",
    });
  });
  it("builds a debit/credit mapping and reads a currency column", () => {
    const mapping = buildMapping({
      ...base,
      roles: { 0: "date", 2: "description", 4: "currency", 5: "debit", 6: "credit" },
    });
    expect(mapping?.amount).toEqual({ mode: "debit_credit", debitColumn: "Column 6", creditColumn: "Column 7" });
    expect(mapping?.currencyColumn).toBe("Column 5");
  });
  it("returns null when a required role is missing", () => {
    expect(buildMapping({ ...base, roles: { 2: "description", 5: "amount" } })).toBeNull(); // no date
    expect(buildMapping({ ...base, roles: { 0: "date", 5: "amount" } })).toBeNull(); // no description
    expect(buildMapping({ ...base, roles: { 0: "date", 2: "description", 5: "debit" } })).toBeNull(); // credit missing
  });
});

describe("mappingToRoles", () => {
  it("inverts a signed mapping back to per-column roles", () => {
    const mapping: ColumnMapping = {
      dateColumn: "Column 1",
      dateFormat: "DD-MM-YYYY",
      descriptionColumns: ["Column 3", "Column 4"],
      amount: { mode: "signed", amountColumn: "Column 6" },
      decimalSep: ",",
      defaultCurrency: "PLN",
    };
    expect(mappingToRoles(mapping)).toEqual({ 0: "date", 2: "description", 3: "description", 5: "amount" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- roles`
Expected: FAIL — module `@/lib/csv/roles` does not exist.

- [ ] **Step 3: Implement the module**

Create `lib/csv/roles.ts`:

```ts
import type { ColumnMapping, DateFormat } from "@/lib/domain/types";
import { columnKey, columnIndex } from "@/lib/csv/parse";

export type ColumnRole = "ignore" | "date" | "description" | "amount" | "debit" | "credit" | "currency";

export interface MappingDraft {
  /** Role chosen per column index (0-based); absent columns are treated as "ignore". */
  roles: Record<number, ColumnRole>;
  dateFormat: DateFormat;
  decimalSep: "," | ".";
  defaultCurrency: string;
}

function indicesWithRole(roles: Record<number, ColumnRole>, role: ColumnRole): number[] {
  return Object.keys(roles)
    .map(Number)
    .filter((i) => roles[i] === role)
    .sort((a, b) => a - b);
}

function firstWithRole(roles: Record<number, ColumnRole>, role: ColumnRole): number | null {
  const hits = indicesWithRole(roles, role);
  return hits.length > 0 ? hits[0] : null;
}

/**
 * Translate per-column role assignments into a ColumnMapping, or null when the
 * required roles are missing (need a date, ≥1 description, and either a single
 * amount column or both a debit and a credit column).
 */
export function buildMapping(draft: MappingDraft): ColumnMapping | null {
  const dateIdx = firstWithRole(draft.roles, "date");
  const descIdx = indicesWithRole(draft.roles, "description");
  const amountIdx = firstWithRole(draft.roles, "amount");
  const debitIdx = firstWithRole(draft.roles, "debit");
  const creditIdx = firstWithRole(draft.roles, "credit");
  const currencyIdx = firstWithRole(draft.roles, "currency");

  if (dateIdx === null || descIdx.length === 0) return null;

  let amount: ColumnMapping["amount"];
  if (amountIdx !== null) {
    amount = { mode: "signed", amountColumn: columnKey(amountIdx) };
  } else if (debitIdx !== null && creditIdx !== null) {
    amount = { mode: "debit_credit", debitColumn: columnKey(debitIdx), creditColumn: columnKey(creditIdx) };
  } else {
    return null;
  }

  return {
    dateColumn: columnKey(dateIdx),
    dateFormat: draft.dateFormat,
    descriptionColumns: descIdx.map(columnKey),
    amount,
    decimalSep: draft.decimalSep,
    currencyColumn: currencyIdx !== null ? columnKey(currencyIdx) : undefined,
    defaultCurrency: draft.defaultCurrency,
  };
}

/** Invert a ColumnMapping into per-column roles, to seed the grid from a guess/profile. */
export function mappingToRoles(mapping: ColumnMapping): Record<number, ColumnRole> {
  const roles: Record<number, ColumnRole> = {};
  const set = (key: string, role: ColumnRole) => {
    const i = columnIndex(key);
    if (i >= 0) roles[i] = role;
  };
  set(mapping.dateColumn, "date");
  mapping.descriptionColumns.forEach((c) => set(c, "description"));
  if (mapping.amount.mode === "signed") {
    set(mapping.amount.amountColumn, "amount");
  } else {
    set(mapping.amount.debitColumn, "debit");
    set(mapping.amount.creditColumn, "credit");
  }
  if (mapping.currencyColumn) set(mapping.currencyColumn, "currency");
  return roles;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- roles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/roles.ts lib/csv/__tests__/roles.test.ts
git commit -m "feat(csv): pure role<->ColumnMapping translation"
```

---

## Task 4: Auto-detect heuristics (`lib/csv/detect.ts`)

**Files:**
- Create: `lib/csv/detect.ts`
- Test: `lib/csv/__tests__/detect.test.ts`

**Key behavior to lock in:** `guessDateColumn` returns the **leftmost** column whose best date-format match meets the threshold (not the globally highest-scoring one). This matters: in a file whose account-info preamble shares the transactions' *value-date* column but differs in the *booking-date* column's format, only the leftmost (booking) date column reveals the preamble — so it must win.

- [ ] **Step 1: Write the failing tests**

Create `lib/csv/__tests__/detect.test.ts`. The matrices below mirror the user's two real bank files (file 1 has no preamble; file 2 starts with an account-info line whose booking date is `YYYY-MM-DD` while transactions use `DD-MM-YYYY`):

```ts
import { describe, it, expect } from "vitest";
import { guessMapping, guessDateColumn, detectStartRow } from "@/lib/csv/detect";

// File 1 shape: 9 columns, no preamble, booking + value dates in DD-MM-YYYY.
const noPreamble: string[][] = [
  ["31-05-2026", "31-05-2026", "UZNANIE Odsetki od salda dodatniego", "", "", "37,40", "33981,46", "1", ""],
  ["31-05-2026", "31-05-2026", "OBCIAZENIE Podatek pobrany", "", "", "-7,11", "33974,35", "2", ""],
  ["04-05-2026", "04-05-2026", "Between your own accounts", "MACIEJ M", "08 1090 2590", "-10000,00", "33944,06", "3", ""],
  ["02-05-2026", "02-05-2026", "BIEDRONKA 123 BIALYSTOK", "", "", "-45,20", "33989,26", "4", ""],
  ["01-05-2026", "01-05-2026", "Przelew przychodzacy", "JAN KOWALSKI", "12 3456", "2500,00", "34034,46", "5", ""],
];

// File 2 shape: 9 columns, row 0 is an account-info line (booking date YYYY-MM-DD), then 5 transactions.
const withPreamble: string[][] = [
  ["2026-06-02", "01-06-2026", "'08 1090 2590 0000 0001 4198 1663", "MACIEJ M", "PLN", "5667,08", "5767,08", "1", ""],
  ["01-06-2026", "01-06-2026", "dzien dziecka - na lody", "URSZULA M", "96 1910", "100,00", "5767,08", "1", ""],
  ["31-05-2026", "31-05-2026", "BLIK zakup", "SKLEP", "", "-23,50", "5667,08", "2", ""],
  ["30-05-2026", "30-05-2026", "Wyplata BLIK", "", "", "-200,00", "5691,08", "3", ""],
  ["29-05-2026", "29-05-2026", "Wynagrodzenie", "FIRMA", "11 2222", "4500,00", "5891,08", "4", ""],
  ["28-05-2026", "28-05-2026", "ZABKA Z123", "", "", "-15,99", "6091,08", "5", ""],
];

describe("guessDateColumn", () => {
  it("prefers the leftmost column meeting the threshold", () => {
    // Both col 0 and col 1 are DD-MM-YYYY here; the leftmost (col 0) must win.
    expect(guessDateColumn(noPreamble, 9)).toEqual({ index: 0, format: "DD-MM-YYYY" });
  });
  it("keys off the booking-date column even when it has a preamble in another format", () => {
    expect(guessDateColumn(withPreamble, 9)).toEqual({ index: 0, format: "DD-MM-YYYY" });
  });
});

describe("guessMapping", () => {
  it("guesses date, amount, and decimal separator for the bank layout", () => {
    const m = guessMapping(noPreamble, 9, "PLN");
    expect(m.dateColumn).toBe("Column 1");
    expect(m.dateFormat).toBe("DD-MM-YYYY");
    expect(m.amount).toEqual({ mode: "signed", amountColumn: "Column 6" });
    expect(m.decimalSep).toBe(",");
    expect(m.descriptionColumns.length).toBeGreaterThan(0);
  });
});

describe("detectStartRow", () => {
  it("returns 0 when the first row is already a transaction", () => {
    const m = guessMapping(noPreamble, 9, "PLN");
    expect(detectStartRow(noPreamble, m)).toBe(0);
  });
  it("skips a leading account-info line", () => {
    const m = guessMapping(withPreamble, 9, "PLN");
    expect(detectStartRow(withPreamble, m)).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- detect`
Expected: FAIL — module `@/lib/csv/detect` does not exist.

- [ ] **Step 3: Implement the module**

Create `lib/csv/detect.ts`:

```ts
import type { ColumnMapping, DateFormat } from "@/lib/domain/types";
import { parseDate } from "@/lib/domain/dates";
import { parseAmount } from "@/lib/domain/money";
import { columnKey, columnIndex } from "@/lib/csv/parse";

const DATE_FORMATS: DateFormat[] = ["DD-MM-YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
const DECIMAL_SEPS: Array<"," | "."> = [",", "."];
const PARSE_THRESHOLD = 0.8;

function parsesAsDate(cell: string, fmt: DateFormat): boolean {
  try {
    parseDate(cell, fmt);
    return true;
  } catch {
    return false;
  }
}

function parsesAsAmount(cell: string, sep: "," | "."): boolean {
  if (cell.trim() === "") return false;
  try {
    parseAmount(cell, { decimalSep: sep });
    return true;
  } catch {
    return false;
  }
}

function column(rows: string[][], index: number): string[] {
  return rows.map((r) => r[index] ?? "");
}

function nonEmpty(cells: string[]): string[] {
  return cells.filter((c) => c.trim() !== "");
}

/** Fraction (0..1) of non-empty cells satisfying `pred`; 0 when the column is empty. */
function fractionMatching(cells: string[], pred: (c: string) => boolean): number {
  const present = nonEmpty(cells);
  if (present.length === 0) return 0;
  return present.filter(pred).length / present.length;
}

/**
 * Leftmost column whose best date-format match meets the threshold, with that
 * format. Leftmost-wins is deliberate: the booking-date column (often col 0) is
 * what exposes an account-info preamble that shares the value-date column.
 */
export function guessDateColumn(rows: string[][], columns: number): { index: number; format: DateFormat } | null {
  for (let i = 0; i < columns; i++) {
    const cells = column(rows, i);
    let best: { format: DateFormat; score: number } | null = null;
    for (const fmt of DATE_FORMATS) {
      const score = fractionMatching(cells, (c) => parsesAsDate(c, fmt));
      if (best === null || score > best.score) best = { format: fmt, score };
    }
    if (best && best.score >= PARSE_THRESHOLD) return { index: i, format: best.format };
  }
  return null;
}

/** Decimal separator that parses the most money-looking cells across all columns. */
export function guessDecimalSep(rows: string[][], columns: number): "," | "." {
  let best: "," | "." = ",";
  let bestCount = -1;
  for (const sep of DECIMAL_SEPS) {
    let count = 0;
    for (let i = 0; i < columns; i++) {
      for (const c of column(rows, i)) {
        if (c.includes(sep) && parsesAsAmount(c, sep)) count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = sep;
    }
  }
  return best;
}

/**
 * Best amount column: among mostly-numeric columns (excluding the date column),
 * prefer one with a decimal separator and at least one negative value — this
 * distinguishes a signed amount column from a running balance or a row index.
 */
export function guessAmountColumn(rows: string[][], columns: number, sep: "," | ".", excludeIndex: number): number | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < columns; i++) {
    if (i === excludeIndex) continue;
    const cells = column(rows, i);
    if (fractionMatching(cells, (c) => parsesAsAmount(c, sep)) < PARSE_THRESHOLD) continue;
    const present = nonEmpty(cells);
    const hasDecimal = present.some((c) => c.includes(sep));
    const hasNegative = present.some((c) => {
      try {
        return parseAmount(c, { decimalSep: sep }) < 0;
      } catch {
        return false;
      }
    });
    const score = (hasNegative ? 2 : 0) + (hasDecimal ? 1 : 0);
    if (best === null || score > best.score) best = { index: i, score };
  }
  return best ? best.index : null;
}

/** Longest mostly-text column (excluding given indices) → description. */
export function guessDescriptionColumn(rows: string[][], columns: number, exclude: number[]): number | null {
  let best: { index: number; avgLen: number } | null = null;
  for (let i = 0; i < columns; i++) {
    if (exclude.includes(i)) continue;
    const present = nonEmpty(column(rows, i));
    if (present.length === 0) continue;
    const numericish = present.filter((c) => /^[\d\s.,+\-/]+$/.test(c)).length / present.length;
    if (numericish >= 0.5) continue;
    const avgLen = present.reduce((s, c) => s + c.trim().length, 0) / present.length;
    if (best === null || avgLen > best.avgLen) best = { index: i, avgLen };
  }
  return best ? best.index : null;
}

/** Auto-guess a full ColumnMapping from sampled rows (best-effort; the preview corrects it). */
export function guessMapping(rows: string[][], columns: number, defaultCurrency: string): ColumnMapping {
  const sep = guessDecimalSep(rows, columns);
  const date = guessDateColumn(rows, columns);
  const dateIdx = date?.index ?? 0;
  const amountIdx = guessAmountColumn(rows, columns, sep, dateIdx);
  const descIdx = guessDescriptionColumn(rows, columns, [dateIdx, ...(amountIdx !== null ? [amountIdx] : [])]);

  return {
    dateColumn: columnKey(dateIdx),
    dateFormat: date?.format ?? "YYYY-MM-DD",
    descriptionColumns: descIdx !== null ? [columnKey(descIdx)] : [],
    amount: { mode: "signed", amountColumn: columnKey(amountIdx ?? 0) },
    decimalSep: sep,
    defaultCurrency,
  };
}

/**
 * Index of the first row that parses as a transaction under `mapping` (its date
 * cell parses in the mapped format AND its amount cell parses). Returns 0 when no
 * row qualifies — the UI then prompts the user to pick the start row manually.
 */
export function detectStartRow(rows: string[][], mapping: ColumnMapping): number {
  const dateIdx = columnIndex(mapping.dateColumn);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (dateIdx < 0 || !parsesAsDate(row[dateIdx] ?? "", mapping.dateFormat)) continue;
    let amountOk: boolean;
    if (mapping.amount.mode === "signed") {
      amountOk = parsesAsAmount(row[columnIndex(mapping.amount.amountColumn)] ?? "", mapping.decimalSep);
    } else {
      const d = row[columnIndex(mapping.amount.debitColumn)] ?? "";
      const c = row[columnIndex(mapping.amount.creditColumn)] ?? "";
      amountOk = parsesAsAmount(d, mapping.decimalSep) || parsesAsAmount(c, mapping.decimalSep);
    }
    if (amountOk) return i;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- detect`
Expected: PASS — `guessDateColumn` returns `{index:0, format:"DD-MM-YYYY"}` for both files; `detectStartRow` returns `0` (no preamble) and `1` (preamble).

- [ ] **Step 5: Commit**

```bash
git add lib/csv/detect.ts lib/csv/__tests__/detect.test.ts
git commit -m "feat(csv): auto-guess mapping + detect transaction start row"
```

---

## Task 5: Preview endpoint (`app/api/import/preview/route.ts`)

**Files:**
- Create: `app/api/import/preview/route.ts`

This handler delegates all logic to the pure functions tested in Tasks 1–4; it is verified by typecheck/lint here and the manual checklist in Task 10 (matching the repo's existing untested-route pattern).

- [ ] **Step 1: Create the route**

Create `app/api/import/preview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importTooLarge, MAX_IMPORT_BYTES } from "@/lib/import/limits";
import { parseCsvMatrixBuffer } from "@/lib/csv/parse";
import { layoutSignature } from "@/lib/csv/profile";
import { getProfileBySignature } from "@/lib/repos/imports";
import { guessMapping, detectStartRow } from "@/lib/csv/detect";
import type { SupportedEncoding } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_ROWS = 15;
const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";

function readEncoding(form: FormData): SupportedEncoding | undefined {
  const raw = form.get("encoding");
  return raw === "utf-8" || raw === "win1250" ? raw : undefined;
}

/**
 * Read-only preview for the import wizard. Parses a headerless CSV, auto-guesses
 * the positional column mapping + where transactions start (skipping any
 * account-info preamble), and returns a sample for the editable grid. No writes.
 */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "'file' is required" }, { status: 400 });
  }
  if (importTooLarge(file.size)) {
    return NextResponse.json(
      { error: `File too large. Maximum ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { columns, rows, encoding, delimiter } = parseCsvMatrixBuffer(buf, { encoding: readEncoding(form) });

  if (columns === 0 || rows.length === 0) {
    return NextResponse.json({ error: "No data found in the file." }, { status: 422 });
  }

  const db = createAdminClient();
  const profile = await getProfileBySignature(db, layoutSignature(columns, delimiter));
  const mapping = profile?.columnMapping ?? guessMapping(rows, columns, DEFAULT_CURRENCY);
  const startRow = detectStartRow(rows, mapping);

  return NextResponse.json({
    status: "preview",
    columns,
    sampleRows: rows.slice(0, PREVIEW_ROWS),
    totalRows: rows.length,
    encoding,
    delimiter,
    guess: { startRow, mapping },
    hasSavedProfile: profile !== null,
  });
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run typecheck`
Expected: PASS (no type errors).
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/import/preview/route.ts
git commit -m "feat(import): read-only preview endpoint (guess mapping + start row)"
```

---

## Task 6: Commit endpoint — headerless + startRow (`app/api/import/route.ts`)

**Files:**
- Modify: `app/api/import/route.ts` (replace the handler body)

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/import/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importTooLarge, MAX_IMPORT_BYTES } from "@/lib/import/limits";
import { getAnthropicClient } from "@/lib/ai/client";
import { parseCsvMatrixBuffer, matrixToRawRows } from "@/lib/csv/parse";
import { layoutSignature } from "@/lib/csv/profile";
import { saveProfile } from "@/lib/repos/imports";
import { runImport } from "@/lib/import/run";
import type { ColumnMapping, SupportedEncoding } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readEncoding(form: FormData): SupportedEncoding | undefined {
  const raw = form.get("encoding");
  return raw === "utf-8" || raw === "win1250" ? raw : undefined;
}

/**
 * Commit a CSV import. Multipart form-data: `file`, `accountId`, `mapping`
 * (JSON ColumnMapping over synthetic positional columns), `startRow` (count of
 * leading non-transaction preamble rows to drop), and an optional `encoding`
 * echoed from the preview. Parses headerless, drops the preamble, runs the
 * pipeline, then remembers the bank's positional layout for next time.
 */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  const accountId = form.get("accountId");
  const mappingRaw = form.get("mapping");
  if (!(file instanceof File) || typeof accountId !== "string" || !accountId || typeof mappingRaw !== "string") {
    return NextResponse.json({ error: "'file', 'accountId', and 'mapping' are required" }, { status: 400 });
  }
  if (importTooLarge(file.size)) {
    return NextResponse.json(
      { error: `File too large. Maximum ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }

  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(mappingRaw) as ColumnMapping;
  } catch {
    return NextResponse.json({ error: "'mapping' must be valid JSON" }, { status: 400 });
  }

  const startRowRaw = form.get("startRow");
  const startRow = typeof startRowRaw === "string" ? Math.max(0, parseInt(startRowRaw, 10) || 0) : 0;

  const buf = Buffer.from(await file.arrayBuffer());
  const { columns, rows, delimiter, encoding } = parseCsvMatrixBuffer(buf, { encoding: readEncoding(form) });
  const dataRows = matrixToRawRows(rows.slice(startRow), columns);

  const db = createAdminClient();
  try {
    const summary = await runImport(
      { db, anthropic: getAnthropicClient() },
      { accountId, rows: dataRows, mapping, fileName: file.name },
    );
    await saveProfile(db, {
      headerSignature: layoutSignature(columns, delimiter),
      columnMapping: mapping,
      dateFormat: mapping.dateFormat,
      delimiter,
      decimalSep: mapping.decimalSep,
      encoding,
    });
    return NextResponse.json({ status: "imported", ...summary });
  } catch {
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/import/route.ts
git commit -m "feat(import): commit headerless imports, drop preamble, save positional layout"
```

---

## Task 7: Dropzone component (`components/import/import-dropzone.tsx`)

**Files:**
- Create: `components/import/import-dropzone.tsx`

- [ ] **Step 1: Create the component**

Create `components/import/import-dropzone.tsx`:

```tsx
"use client";

import { useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/** Drag-and-drop / click target that accepts a single .csv file (type-guarded). */
export function ImportDropzone({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") return;
    onFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Upload className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">Drop a CSV here, or click to browse</p>
      <p className="text-xs text-muted-foreground">Bank statement export · max 4&nbsp;MB</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/import/import-dropzone.tsx
git commit -m "feat(import): drag-and-drop CSV dropzone"
```

---

## Task 8: Preview grid component (`components/import/import-preview.tsx`)

**Files:**
- Create: `components/import/import-preview.tsx`

Uses the tested `buildMapping` / `mappingToRoles` from Task 3 for all role↔mapping logic; the component only holds UI state.

- [ ] **Step 1: Create the component**

Create `components/import/import-preview.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { ColumnMapping, DateFormat, SupportedEncoding } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";
import { buildMapping, mappingToRoles, type ColumnRole } from "@/lib/csv/roles";
import { cn } from "@/lib/utils";

const DATE_FORMATS: DateFormat[] = ["DD-MM-YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
const ROLES: { value: ColumnRole; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "date", label: "Date" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "debit", label: "Debit" },
  { value: "credit", label: "Credit" },
  { value: "currency", label: "Currency" },
];

export interface ImportPreviewProps {
  columns: number;
  sampleRows: string[][];
  totalRows: number;
  initialMapping: ColumnMapping;
  initialStartRow: number;
  encoding: SupportedEncoding;
  defaultCurrency: string;
  busy: boolean;
  onImport: (mapping: ColumnMapping, startRow: number) => void;
  onEncodingChange: (encoding: SupportedEncoding) => void;
  onBack: () => void;
}

export function ImportPreview(props: ImportPreviewProps) {
  const { columns, sampleRows, totalRows, initialMapping, initialStartRow, encoding, defaultCurrency, busy } = props;
  const [roles, setRoles] = useState<Record<number, ColumnRole>>(() => mappingToRoles(initialMapping));
  const [dateFormat, setDateFormat] = useState<DateFormat>(initialMapping.dateFormat);
  const [decimalSep, setDecimalSep] = useState<"," | ".">(initialMapping.decimalSep);
  const [currency, setCurrency] = useState(initialMapping.defaultCurrency || defaultCurrency);
  const [startRow, setStartRow] = useState(initialStartRow);

  const mapping = useMemo(
    () => buildMapping({ roles, dateFormat, decimalSep, defaultCurrency: currency }),
    [roles, dateFormat, decimalSep, currency],
  );

  function setRole(col: number, role: ColumnRole) {
    setRoles((prev) => ({ ...prev, [col]: role }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Date format
          <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Decimal separator
          <Select value={decimalSep} onChange={(e) => setDecimalSep(e.target.value as "," | ".")}>
            <option value=",">comma (1 234,56)</option>
            <option value=".">dot (1,234.56)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Currency
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Encoding
          <Select value={encoding} onChange={(e) => props.onEncodingChange(e.target.value as SupportedEncoding)}>
            <option value="utf-8">UTF-8</option>
            <option value="win1250">Windows-1250</option>
          </Select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Each column&apos;s dropdown sets its role. Click a row to mark where transactions start — rows above it
        (account info, headers) are skipped.
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="w-8 px-2 py-2"></th>
              {Array.from({ length: columns }, (_, i) => (
                <th key={i} className="px-2 py-2 text-left font-medium">
                  <Select
                    value={roles[i] ?? "ignore"}
                    onChange={(e) => setRole(i, e.target.value as ColumnRole)}
                    className="h-7 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </Select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, ri) => {
              const skipped = ri < startRow;
              return (
                <tr
                  key={ri}
                  onClick={() => setStartRow(ri)}
                  className={cn(
                    "cursor-pointer border-t hover:bg-accent/50",
                    skipped && "text-muted-foreground/50 line-through",
                    ri === startRow && "bg-primary/5",
                  )}
                >
                  <td className="px-2 py-1 text-center text-muted-foreground">{ri === startRow ? "▶" : ri + 1}</td>
                  {Array.from({ length: columns }, (_, ci) => (
                    <td key={ci} className="max-w-[12rem] truncate px-2 py-1">{row[ci] ?? ""}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {sampleRows.length} of {totalRows} rows · importing from row {startRow + 1} onward.
      </p>

      {!mapping && (
        <p className="text-xs text-amber-400">
          Map a Date column, at least one Description column, and an Amount (or both Debit and Credit).
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={props.onBack} className="rounded-md border px-4 py-2 text-sm">
          Back
        </button>
        <button
          type="button"
          disabled={!mapping || busy}
          onClick={() => mapping && props.onImport(mapping, startRow)}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/import/import-preview.tsx
git commit -m "feat(import): editable preview grid (column roles + start-row picker)"
```

---

## Task 9: Wizard refactor + remove old form (`components/import/import-wizard.tsx`)

**Files:**
- Modify: `components/import/import-wizard.tsx` (rewrite)
- Delete: `components/import/column-mapping-form.tsx`

- [ ] **Step 1: Confirm nothing else imports the old form**

Run: `git grep -n "column-mapping-form"`
Expected: only `components/import/import-wizard.tsx` references it. (If anything else does, stop and reconcile before deleting.)

- [ ] **Step 2: Rewrite the wizard**

Replace the entire contents of `components/import/import-wizard.tsx` with:

```tsx
"use client";

import { useState } from "react";
import type { ColumnMapping, SupportedEncoding } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";
import { ImportDropzone } from "@/components/import/import-dropzone";
import { ImportPreview } from "@/components/import/import-preview";

interface ImportSummary {
  inserted: number;
  duplicates: number;
  aiCategorized: number;
  rowCount: number;
  errors: { rowIndex: number; message: string }[];
}

interface PreviewData {
  columns: number;
  sampleRows: string[][];
  totalRows: number;
  encoding: SupportedEncoding;
  delimiter: string;
  guess: { startRow: number; mapping: ColumnMapping };
  hasSavedProfile: boolean;
}

type Step = "upload" | "preview" | "done";

export function ImportWizard({
  accounts,
  defaultCurrency,
}: {
  accounts: { id: string; name: string }[];
  defaultCurrency: string;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadPreview(f: File, encoding?: SupportedEncoding) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", f);
      if (encoding) form.set("encoding", encoding);
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      const data = (await res.json()) as PreviewData | { error: string };
      if ("error" in data) {
        setError(data.error);
        return;
      }
      setPreview(data);
      setStep("preview");
    } catch {
      setError("Couldn't read that file — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onFile(f: File) {
    setFile(f);
    void loadPreview(f);
  }

  function changeEncoding(encoding: SupportedEncoding) {
    if (file) void loadPreview(file, encoding);
  }

  async function doImport(mapping: ColumnMapping, startRow: number) {
    if (!file || !accountId || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("accountId", accountId);
      form.set("mapping", JSON.stringify(mapping));
      form.set("startRow", String(startRow));
      form.set("encoding", preview.encoding);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = (await res.json()) as ({ status: "imported" } & ImportSummary) | { error: string };
      if ("error" in data) {
        setError(data.error);
        return;
      }
      setSummary(data);
      setStep("done");
    } catch {
      setError("Import failed — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setSummary(null);
    setError(null);
  }

  if (accounts.length === 0) {
    return <p className="text-muted-foreground text-sm">Create an account in Settings before importing.</p>;
  }

  return (
    <div className="max-w-3xl">
      {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}

      {step === "upload" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Account
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </label>
          <ImportDropzone onFile={onFile} disabled={busy} />
          {busy && <p className="text-sm text-muted-foreground">Reading file…</p>}
        </div>
      )}

      {step === "preview" && preview && (
        <ImportPreview
          columns={preview.columns}
          sampleRows={preview.sampleRows}
          totalRows={preview.totalRows}
          initialMapping={preview.guess.mapping}
          initialStartRow={preview.guess.startRow}
          encoding={preview.encoding}
          defaultCurrency={defaultCurrency}
          busy={busy}
          onImport={doImport}
          onEncodingChange={changeEncoding}
          onBack={reset}
        />
      )}

      {step === "done" && summary && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Import complete</h2>
          <ul className="text-sm">
            <li>Imported: {summary.inserted}</li>
            <li>Duplicates skipped: {summary.duplicates}</li>
            <li>AI-categorized: {summary.aiCategorized}</li>
            <li>Rows processed: {summary.rowCount}</li>
            {summary.errors.length > 0 ? (
              <li className="text-amber-400">Rows skipped (parse errors): {summary.errors.length}</li>
            ) : null}
          </ul>
          <button type="button" onClick={reset} className="self-start rounded-md border px-4 py-2 text-sm">
            Import another
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Delete the old mapping form**

```bash
git rm components/import/column-mapping-form.tsx
```

- [ ] **Step 4: Verify it compiles and lints**

Run: `npm run typecheck`
Expected: PASS (no dangling import of `column-mapping-form`).
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/import/import-wizard.tsx
git commit -m "refactor(import): wizard drives dropzone + preview grid; drop old mapping form"
```

---

## Task 10: Full verification & manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full fast suite + typecheck + lint**

Run: `npm test`
Expected: PASS (all suites, including the new parse/profile/roles/detect tests and the existing import pipeline tests).
Run: `npm run typecheck`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Manual smoke test against the real files**

Start the app (`npm run dev`), sign in, open **Import**, and verify with the user's two sample CSVs:

1. **File without preamble** (`historia_…156628467.csv`): dropzone accepts the drop → preview shows 9 columns with Date/Description/Amount pre-selected, start row = **row 1** (nothing greyed). Import succeeds; summary shows the expected counts.
2. **File with preamble** (`historia_…141981663.csv`): preview greys out the **account-info first row**, start row = **row 2**. Amounts in the grid look right (`,` decimals); Polish characters render correctly (flip Encoding if they look garbled). Import succeeds and does **not** insert the account-info line as a transaction.
3. **Re-import the same file**: the preview comes back pre-filled from the saved layout (one glance, then Import). Re-importing inserts 0 new rows (all duplicates) — confirms dedup still works.
4. **Validation**: set the Amount column to "Ignore" → the Import button disables and the amber hint appears.

- [ ] **Step 3: Final commit (if any doc/notes changed)**

If the manual test surfaced no code changes, nothing to commit. If small fixes were needed, commit them:

```bash
git add -A
git commit -m "fix(import): address manual smoke-test findings"
```

---

## Self-Review Notes

- **Spec coverage:** headerless positional parsing (Task 1), layout signature with no migration (Task 2), auto-guess + start-row detection with the leftmost-date-column rule that makes the preamble detectable (Task 4), two-endpoint split with stateless re-upload (Tasks 5–6), dropzone + editable preview grid + encoding override (Tasks 7–8), wizard `upload→preview→done` and removal of the old form (Task 9), tests on the two real files + dedup re-import check (Tasks 4 & 10). All spec sections map to a task.
- **Type consistency:** `ColumnRole`, `MappingDraft`, `buildMapping`, `mappingToRoles`, `CsvMatrix`, `ParseMatrixResult`, `parseCsvMatrix`, `parseCsvMatrixBuffer`, `matrixToRawRows`, `columnKey`, `columnIndex`, `layoutSignature`, `guessMapping`, `detectStartRow` are defined in Tasks 1–4 and consumed with the same signatures in Tasks 5–9. `PreviewData` (wizard) matches the preview route's JSON shape.
- **No migration:** the positional `layoutSignature` is stored in the existing `import_profiles.header_signature` column via the unchanged `saveProfile`.
