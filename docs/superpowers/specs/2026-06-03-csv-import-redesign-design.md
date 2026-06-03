# CSV Import Redesign — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Related:** `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md`, Phase 6b (`docs/superpowers/plans/2026-05-31-phase-6b-transactions-import.md`)

## Problem

The current CSV import is both **ugly** and **structurally wrong** for the user's real bank exports.

1. **UI** — a bare 3-step wizard with a native `<input type="file">` and an abstract column-mapping form ([components/import/import-wizard.tsx](../../../components/import/import-wizard.tsx), [components/import/column-mapping-form.tsx](../../../components/import/column-mapping-form.tsx)). No drag-and-drop, no preview, no sense of what is about to be imported.

2. **Parsing model** — the importer assumes a **column-name header row**: `parseCsv` runs Papa with `header: true`, mappings reference header *names*, and saved bank profiles are keyed by a hash of the header row ([lib/csv/parse.ts](../../../lib/csv/parse.ts), [lib/csv/profile.ts](../../../lib/csv/profile.ts), [app/api/import/route.ts](../../../app/api/import/route.ts)). The user's bank exports are **headerless** — they start straight with transaction rows, and *sometimes* begin with a non-transaction **account-info / opening-balance line**. Consequences:
   - The first transaction (or the account-info line) is consumed as "column names."
   - The header signature is unstable across exports, so a bank's layout can never be reliably remembered.
   - The user's only workaround today is manually deleting the first line — which still does not fix the header-eating problem.

## Goals

- A clean, modern upload experience consistent with the existing dark-theme / shadcn UI.
- Correct handling of **headerless** files via **position-based** column mapping.
- **Auto-detect** where real transactions begin (skipping the optional account-info preamble) and what each column is, then show it in an **editable preview** the user confirms before importing.
- Remember the bank's column layout so repeat imports are essentially one click.

## Non-goals (YAGNI)

- Multi-file upload (user imports one file at a time).
- Multiple banks / multiple layouts in one session (user has a single bank; the layout-signature mechanism still tolerates more later, but we do not build UI for it).
- A client-side CSV parser (parsing stays on the server; the preview is server-rendered data).
- Persisting parsed file bytes server-side between preview and import (stateless re-upload instead).

## Decisions (from brainstorming)

- **File shape:** headerless, sometimes preceded by a single account-info line. Single bank.
- **Preamble handling:** auto-detect the start row + auto-guess column roles, shown in an editable preview the user can correct.
- **Scope:** one file at a time.
- **Recommended approach chosen:** "Smart preview" importer (Approach A).

## Architecture

### Parsing model: headerless → positional

- The import path parses with Papa `header: false`, producing string arrays.
- Rows are padded to the **maximum column count** found in the file, and each column is given a **synthetic stable key**: `Column 1 … Column N`.
- Those synthetic keys become the `RawRow` object keys. **The entire existing pipeline downstream works unchanged** (`applyMapping` → `requireColumn` → `normalizeMerchant` → `computeDedupHash` → `categorizeByRules` → AI → `insertDrafts`). A `ColumnMapping` simply references `"Column 6"` instead of `"Amount"`.
- The existing header-based parse functions remain in place (not deleted) but are no longer used by the import flow.

### Two endpoints (separated by responsibility)

**`POST /api/import/preview`** — read-only, performs no writes:
- Input: multipart `file` (+ optional `encoding` override).
- Steps: size/type guard → decode (detect or honor override) → detect delimiter → headerless parse → synthesize column keys → look up a saved layout profile by **layout signature** → `guessMapping()` + `detectStartRow()`.
- Output:
  ```
  {
    status: "preview",
    columns: number,
    sampleRows: string[][],   // first ~15 rows, raw decoded values
    totalRows: number,
    encoding: SupportedEncoding,
    delimiter: Delimiter,
    guess: { startRow: number, mapping: ColumnMapping },
    hasSavedProfile: boolean
  }
  ```
- If a saved profile matches the layout signature, `guess.mapping` is the saved mapping (the preview is still shown so the user can catch a varying preamble line).

**`POST /api/import`** — the commit (evolves the existing route):
- Input: multipart `file`, `accountId`, `mapping` (JSON `ColumnMapping`), `startRow` (integer).
- Steps: size/type guard → re-parse headerless → **drop rows with index `< startRow`** → `runImport(...)` (unchanged) → save/update the layout profile.
- Output: the existing import summary (`inserted`, `duplicates`, `aiCategorized`, `rowCount`, `errors`).

The file is re-sent on the commit call (the client already holds the `File`). Stateless — no server-side temp storage. Acceptable given the 4 MB cap and single-user context.

### Remembering the layout

- Header-row signatures are meaningless for headerless files. Replace with **`layoutSignature(columnCount, delimiter)`** = `sha256(`columnCount`|`delimiter`)`.
- Stored in the **existing** `import_profiles.header_signature` column as an opaque key — **no DB migration required**. `saveProfile` / `getProfileBySignature` are reused as-is with the new signature value.
- **`startRow` is NOT stored in the profile.** The account-info preamble appears only *sometimes*, so the skip is re-detected and confirmed per file. Only the stable column→role mapping is remembered.

## Auto-detect heuristics (`lib/csv/detect.ts`, pure)

**Order:** `guessMapping` runs first over *all* sampled rows (a lone account-info row cannot sway the modal column detection), producing the date/amount/description mapping; then `detectStartRow` uses that mapping to find where transactions begin.

- **`guessMapping(sampleRows, columnCount)`** — over the sampled rows:
  - Column whose values mostly parse as dates → **Date**; infer the date format (`DD-MM-YYYY` vs `YYYY-MM-DD`, etc.) from the values.
  - Column whose values mostly parse as signed decimals → **Amount**; infer decimal separator (`,` vs `.`).
  - Longest free-text column → **Description**.
  - Remaining columns default to **Ignore**. The guess is best-effort; the preview is the safety net.
- **`detectStartRow(rows, mapping)`** — the index of the first row where the chosen **date column parses under the chosen format** *and* the chosen **amount column parses as a number**. Leading rows that fail (account-info preamble) are skipped.
  - Confirmed by fixtures: file 2's account-info line uses `YYYY-MM-DD` while transactions use `DD-MM-YYYY`, so it fails the format check and is skipped (`startRow = 1`); file 1 has no preamble (`startRow = 0`).

Both functions are pure and unit-tested.

## UI / Components

States: `upload → preview → done` (replaces today's `upload → map → done`).

- **`components/import/import-dropzone.tsx`** *(new)* — drag-and-drop target (drag-over highlight) that also clicks to browse; validates `.csv` type and size client-side; shows filename + size; hosts the account picker. Drop/select fires the preview call.
- **`components/import/import-preview.tsx`** *(new — replaces `column-mapping-form.tsx`)* — a table of the first ~15 rows:
  - Each **column header is a `Select` dropdown**: Date / Description / Amount / Debit / Credit / Currency / Ignore, pre-filled from the guess. Mapping is done by pointing at real data.
  - Rows above `startRow` are **greyed out** with a "transactions start here" divider; clicking a row sets the start.
  - Controls strip: **date format**, **decimal separator**, **encoding override** (safety valve for Polish diacritics arriving as mojibake — re-decodes via a fresh preview call).
  - `Import` disabled until the mapping is valid (a Date column + an Amount column or a Debit+Credit pair + ≥1 Description column).
- **`components/import/import-wizard.tsx`** — refactored to orchestrate the three states and the two endpoint calls.
- **Done** — the existing summary (imported / duplicates / AI-categorized / rows / skipped-parse-errors) + "Import another."

Styling reuses existing tokens (`bg-primary`, `text-muted-foreground`, dark theme) and the existing `Select` component.

## Error handling

- Oversize (existing 413) / wrong type / empty file → friendly reject before preview.
- No detectable transactions → preview still renders with a "pick the start row manually" hint.
- Wrong encoding → user flips the override; the grid re-decodes.
- Per-row parse failures during commit → still collected in `errors` and surfaced in the summary (unchanged behavior).
- Preview/commit network failure → inline error message, retryable.

## Testing

Fast unit suite stays credential-free (`*.test.ts`); DB/integration stays in `*.itest.ts`.

- **New unit tests** (`lib/csv/__tests__/detect.test.ts`, parse additions) using the **two real sample files as fixtures**:
  - Headerless parse produces synthetic keys `Column 1…N` with padded rows.
  - `detectStartRow`: file 2 → `1` (skips the account-info line), file 1 → `0`.
  - `guessMapping`: identifies the date, amount, and description columns; infers `DD-MM-YYYY` and `,` for this bank.
  - Amounts map to exact minor units end-to-end: `"37,40"` → `3740`, `"-7,11"` → `-711`, `"-10000,00"` → `-1000000`.
- **Existing** `lib/import` pipeline/run tests stay valid (they already consume `RawRow`s).
- **Optional** component test: a grid edit emits the expected `ColumnMapping`.

## File summary

| File | Change |
|------|--------|
| `lib/csv/parse.ts` | Add headerless parse mode + synthetic column keys (`Column 1…N`), padded rows |
| `lib/csv/detect.ts` | **New, pure** — `guessMapping()`, `detectStartRow()` |
| `lib/csv/profile.ts` | Add `layoutSignature(columnCount, delimiter)` |
| `app/api/import/preview/route.ts` | **New** — read-only preview endpoint |
| `app/api/import/route.ts` | Accept `startRow`; parse headerless; drop preamble rows; reuse `runImport` |
| `components/import/import-dropzone.tsx` | **New** — drag-and-drop + validation + account picker |
| `components/import/import-preview.tsx` | **New** — editable preview grid (replaces `column-mapping-form.tsx`) |
| `components/import/column-mapping-form.tsx` | **Removed** (absorbed by the preview grid) |
| `components/import/import-wizard.tsx` | Refactor to `upload → preview → done` + two-call flow |
| `lib/csv/__tests__/detect.test.ts` | **New** — fixtures from the two real files |

No database migration required.
