# Transaction Field Extraction & Categorization — Design

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with user

## Problem

The CSV importer mangles transaction names and leaves most transactions uncategorized.

The app ingests **Santander Bank Polska** statement exports. The real format (confirmed
from the user's exports in `~/Downloads/historia_*.csv`) is a **headerless, 9-column CSV**:

| Col | Meaning | Example |
|-----|---------|---------|
| 1 | Transaction date (`DD-MM-YYYY`) | `31-05-2026` |
| 2 | Booking/value date (`DD-MM-YYYY`) | `29-05-2026` |
| 3 | **Title / note** | `Przelew na telefon Od: 48604263864 Do: 485*****130` |
| 4 | **Counterparty name (+ address)** | `JULIA ZAKRZEWSKA` |
| 5 | Counterparty account (IBAN) | `PL18 1020 1752 0000 0102 0167 4100` |
| 6 | Amount, signed (`"-12,48"`) | `"70,00"` |
| 7 | Balance after operation | `"6015,59"` |
| 8 | Sequence number | `1` |
| 9 | (empty trailing column) | |

The **first row of every export is a summary/preamble line**, not a transaction: col 1 is in
`YYYY-MM-DD` format (vs `DD-MM-YYYY` for real rows), col 3 holds the *own* account number, col 5
holds the currency (`PLN`), and col 8 holds the total transaction count. It must be skipped.

### Root cause of "transfer from: to:"

The importer maps **only the title column (col 3)** into `rawDescription`. For a phone transfer,
col 3 is `Przelew na telefon Od: 48604263864 Do: 485*****130`. The merchant extractor's generic
fallback strips masked numbers (`485*****130`) and long digit runs (`48604263864`) as noise,
leaving `Przelew na telefon Od: Do:` → uppercased to `PRZELEW NA TELEFON OD: DO:` ("transfer
from: to:"). **The actual payee — `JULIA ZAKRZEWSKA` in column 4 — is never read.** Same failure
for `kwiatki dla mamy` → `Szymek`, `pizza` → `Maciek Iwaniuk`, `żelazko` → `Julka`.

### Why most rows are uncategorized

- No seed merchant→category rules exist (`merchant_map` is effectively empty until the user
  corrects rows by hand).
- AI categorization runs only on the extracted `merchant`, without the human note or amount sign,
  so transfers (gifts, rent, salary) have nothing useful to classify on.

## Transaction types observed

Different types carry the merchant/payee in different columns. Extraction must be type-aware.

| Type | Detection (title prefix) | Cols 4/5 | Merchant source | Example |
|------|--------------------------|----------|-----------------|---------|
| **card** | `DOP. VISA … PŁATNOŚĆ KARTĄ <amt> PLN <merchant>` | empty | title (after `PŁATNOŚĆ KARTĄ <amt> PLN`) | `… PŁATNOŚĆ KARTĄ 3.39 PLN ALDI SP. Z O.O. 06 GDANSK` |
| **blik** | `Zakup BLIK …`, `Zwrot BLIK …`, `Przelew BLIK na telefon` | col 4 = merchant | counterparty (col 4), strip `ref:…`/address | `Zakup BLIK Decathlon Sp. z o.o. Geodezyjna 76 ref:…` |
| **transfer** | anything with a counterparty + IBAN | col 4 = person/company | counterparty (col 4) | `kwiatki dla mamy` / `Szymek` |
| **internal** | `Between your own accounts`, `Przelew środków` to self | self | → category **Transfer** | `Between your own accounts` |
| **fee** | `UZNANIE …`, `OBCIĄŻENIE …` | empty | title | `UZNANIE Odsetki od salda dodatniego` |

Card refunds appear as `DOP. VISA … ZWROT PŁATNOŚCI KARTĄ <amt> PLN <merchant>` (positive amount).

## Approach (chosen)

1. **Transaction-type-aware field extraction.** Add `counterparty` + `counterpartyAccount` as
   first-class mapped fields. Classify each row by title prefix, then pull the merchant from the
   correct column. Preserve the full reconstructed line in `raw_description` so nothing is lost.
2. **Seed keyword-rules → AI fallback → learn.** A code-versioned dictionary of Polish merchants,
   loaded into `merchant_map` as `contains` rules; unknown merchants batched to Claude Haiku with
   the taxonomy + note + amount sign; confident AI results (≥ 0.8) persisted as learned rules so
   the app remembers them.
3. **Backfill in place**, preserving manual corrections (`category_source = 'user'`).

Decisions locked with the user:
- **Unknown merchants:** seed dictionary + Claude's built-in knowledge. **No live web search.**
- **Transfers:** categorized smartly from note + payee + amount sign; internal → Transfer.
- **Existing data:** backfilled in place.

## Data flow

```
CSV row ─▶ applyMapping ─▶ MappedFields{ title, counterparty, counterpartyAccount,
                                          amountMinor, currency, bookedAt }
                                │
                                ▼
                    classifyTransaction(title, counterparty) ─▶ TxnType
                                │
                                ▼
        extractMerchant(type, title, counterparty) ─▶ clean display merchant
                                │
        rawDescription = reconstruct(title, counterparty, account)  // nothing discarded
                                │
                                ▼
        categorizeByRules(rawDescription, merchant, rules)  // seed | user | ai
                                │ hit ─▶ use categoryId (source='rule')
                                │ miss
                                ▼
        batch Claude Haiku( note=title, payee=counterparty, amountSign, taxonomy )
                                │ confidence ≥ 0.8
                                ▼
        upsert learned rule (source='ai') ─▶ remembered for future imports
```

## Components

### New

- **`lib/domain/txnType.ts`** — `classifyTransaction(title: string, counterparty: string): TxnType`
  where `TxnType = 'card' | 'blik' | 'transfer' | 'internal' | 'fee'`. Pure, prefix-based,
  diacritic-lenient. Tested against all observed prefixes.
- **`lib/categorize/seedRules.ts`** — exports `SEED_RULES: { pattern: string; matchType:
  'contains' | 'exact'; categoryName: string }[]`. Curated from the user's real data. Examples:
  - Groceries: `LIDL`, `ALDI`, `BIEDRONKA`, `ŻABKA`/`ZABKA`, `LECLERC`, `CARREFOUR`,
    `TOP MARKET`, `DELIKATESY`, `KAUFLAND`, `AUCHAN`
  - Transport: `JAKDOJADE`, `BKM`, `BOLT.EU`, `CITYBIKE`, `CITY-NAV`, `INTERCITY`, `ORLEN`,
    `SYSTEMFALA`, `MPK`
  - Dining: `MCDONALD`, `KEBAB`, `SUSHI`, `BAR MLECZNY`, `GREEK`, `UBER * EATS`, `PIZZA`
  - Health: `ZDROFIT`, `FOX MED`, `NZOZ`, `SUPER-PHARM`, `ROSSMANN`, `FIZJO`, `APTEKA`,
    `BARBERWAVE`
  - Shopping: `IKEA`, `JYSK`, `LEROY MERLIN`, `MEDIA MARKT`, `EURO-NET`, `TERG`, `TEMU`,
    `DECATHLON`, `EMPIK`, `EOBUWIE`, `AGATA`
  - Investing: `XTB`
  - Subscriptions: `NETFLIX`, `SPOTIFY`, `YOUTUBE`, `GOOGLE`, `OPENAI`
  Loaded into `merchant_map` (`source='seed'`) via a seed migration, idempotently.

### Changed

- **`lib/domain/types.ts`** — `MappedFields` and `ColumnMapping` gain `counterparty` /
  `counterpartyColumn` and `counterpartyAccount` / `counterpartyAccountColumn` (optional).
- **`lib/csv/roles.ts`** — add `counterparty` and `counterpartyAccount` to the role union and
  `buildMapping` / `mappingToRoles`.
- **`lib/csv/mapping.ts`** — read counterparty + account columns; set `MappedFields.counterparty`;
  build `rawDescription` from title + counterparty + account (deduped, whitespace-collapsed).
- **`lib/domain/merchant.ts`** — `extractMerchant(type, title, counterparty)`:
  - `card` / `fee` → existing title-based extraction (card extractor already yields `ALDI`).
  - `blik` → counterparty if present, else title between `Zakup BLIK` and `ref:`; strip address.
  - `transfer` / `internal` → counterparty, address stripped (`UL. …`, postcode+city,
    `ELIXIR <date>`), person names Title-Cased.
  - Add address-stripping + Title-Case helpers. `brandNormalize` retained for brand tokens.
- **`lib/import/pipeline.ts`** — call `classifyTransaction`, pass type to `extractMerchant`, build
  the reconstructed `rawDescription`.
- **`lib/ai/categorize.ts`** — extend `CategorizationItem` with `note` (title) and reuse
  `amountMinor` sign; prompt instructs the model to use note + payee + sign for transfers. On a
  suggestion with confidence ≥ 0.8 and a resolvable category, upsert a learned `merchant_map` rule
  (`source='ai'`, `match_type='exact'` on the normalized merchant). Threshold is a named constant.
- **`lib/import/run.ts`** — after AI categorization, persist learned rules (within the import txn).
- **`lib/transactions/backfillMerchants.ts`** — re-derive merchant (type-aware) + re-classify +
  re-run rules for every row where `category_source != 'user'`. Idempotent. Returns counts.
- **Import mapping UI** (the column-mapping step) — expose the two new optional roles.

## Categorization knowledge base & learning

- **Seed** lives in code (`seedRules.ts`), reviewed in git, loaded into `merchant_map` so it is
  unified with user + AI rules and matched by the existing `categorizeByRules` engine.
- **Match precedence** unchanged: `exact` → `contains` → `regex`; first match wins. Seed uses
  mostly `contains` so noisy lines (`JMP S.A. BIEDRONKA 4014 GDANSK`, `ZABKA Z9241 K.1 GDANSK`)
  match on the brand keyword without needing perfect extraction.
- **Remembering:** manual corrections (`applyCorrection`, `source='user'`) and confident AI
  guesses (`source='ai'`) both become rules → future imports skip the AI.
- **Known limitation:** online-payment gateways (`PayU`, `PayPro`, `tpay`, `Paynow`, `Cashbill`,
  `IdoPay`) mask the real merchant; they stay `Other`/uncategorized until the user corrects them
  (then remembered). Documented, not solved.

## Migration & backfill

- One seed migration inserts `SEED_RULES` into `merchant_map` (`source='seed'`), resolving
  category names to ids; idempotent (skip existing `pattern` + `match_type`).
- No transactions schema change: counterparty is folded into `raw_description`; `merchant`
  already exists.
- `scripts/backfill-merchants.ts` (existing CLI) re-runs the new extraction + categorization in
  place; manual corrections preserved.

## UI / display

- Transactions list: **merchant** is the headline (`ALDI`, `Julia Zakrzewska`, `Decathlon`); the
  note (`za hotel booking`) is secondary text. Full reconstructed line stays in `raw_description`
  (searchable). No data hidden.
- Import mapping screen gains the `counterparty` and `counterparty account` optional roles.

## Testing

- **Unit (Vitest)** with fixtures cut from the user's real rows:
  - `txnType`: card / BLIK (zakup, zwrot, przelew) / transfer / internal / fee.
  - `merchant`: `JMP S.A. BIEDRONKA 4014` → `BIEDRONKA`; `ZABKA Z9241 K.1 GDANSK` → `ZABKA`;
    `ALDI SP. Z O.O. 06 GDANSK` → `ALDI`; phone transfer → `Julia Zakrzewska`;
    `MACIEJ MAŁACHOWSKI UL. KROKUSOWA 9 15-584 BIAŁYSTOK` → `Maciej Małachowski`.
  - `mapping`: counterparty captured; `rawDescription` keeps note + payee; preamble row skipped.
  - `seedRules` / `categorizeByRules`: representative seed matches resolve to expected categories.
- **Integration** (`*.itest.ts`, real Supabase): import a fixture file end-to-end; assert merchant
  names, categories, learned-rule persistence, and backfill idempotency (rerun preserves `user`).

## Out of scope (YAGNI)

- Live web search for merchant identification (chose seed + Claude).
- Multi-bank format support (Santander only for now).
- Resolving the real merchant behind payment gateways.
- Auto-creating rules from low-confidence (< 0.8) AI guesses.
