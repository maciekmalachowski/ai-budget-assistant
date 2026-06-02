"use client";

import { useState } from "react";
import type { ColumnMapping, DateFormat } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";

const DATE_FORMATS: DateFormat[] = ["DD.MM.YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];

/** Let the user map a bank's CSV columns onto our fields, then hand back a ColumnMapping. */
export function ColumnMappingForm({
  header,
  defaultCurrency,
  onSubmit,
}: {
  header: string[];
  defaultCurrency: string;
  onSubmit: (mapping: ColumnMapping) => void;
}) {
  const [dateColumn, setDateColumn] = useState(header[0] ?? "");
  const [dateFormat, setDateFormat] = useState<DateFormat>("YYYY-MM-DD");
  const [mode, setMode] = useState<"signed" | "debit_credit">("signed");
  const [amountColumn, setAmountColumn] = useState(header[0] ?? "");
  const [debitColumn, setDebitColumn] = useState(header[0] ?? "");
  const [creditColumn, setCreditColumn] = useState(header[0] ?? "");
  const [descriptionColumns, setDescriptionColumns] = useState<string[]>([]);
  const [decimalSep, setDecimalSep] = useState<"," | ".">(",");
  const [currency, setCurrency] = useState(defaultCurrency);

  function toggleDesc(col: string) {
    setDescriptionColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  }

  const valid =
    dateColumn && descriptionColumns.length > 0 && (mode === "signed" ? !!amountColumn : !!debitColumn && !!creditColumn);

  function submit() {
    const amount: ColumnMapping["amount"] =
      mode === "signed" ? { mode: "signed", amountColumn } : { mode: "debit_credit", debitColumn, creditColumn };
    onSubmit({ dateColumn, dateFormat, descriptionColumns, amount, decimalSep, defaultCurrency: currency });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Date column
        <Select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
          {header.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Date format
        <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">Amount</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === "signed"} onChange={() => setMode("signed")} /> One signed column
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === "debit_credit"} onChange={() => setMode("debit_credit")} /> Separate debit / credit
        </label>
        {mode === "signed" ? (
          <Select value={amountColumn} onChange={(e) => setAmountColumn(e.target.value)}>
            {header.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </Select>
        ) : (
          <div className="flex gap-2">
            <Select value={debitColumn} onChange={(e) => setDebitColumn(e.target.value)}>
              {header.map((h) => (
                <option key={h} value={h}>Debit: {h}</option>
              ))}
            </Select>
            <Select value={creditColumn} onChange={(e) => setCreditColumn(e.target.value)}>
              {header.map((h) => (
                <option key={h} value={h}>Credit: {h}</option>
              ))}
            </Select>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">Description column(s)</legend>
        <div className="flex flex-wrap gap-3">
          {header.map((h) => (
            <label key={h} className="flex items-center gap-2">
              <input type="checkbox" checked={descriptionColumns.includes(h)} onChange={() => toggleDesc(h)} />
              {h}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Decimal separator
          <Select value={decimalSep} onChange={(e) => setDecimalSep(e.target.value as "," | ".")}>
            <option value=",">comma (1 234,56)</option>
            <option value=".">dot (1,234.56)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Default currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 w-24 rounded-md border bg-background px-2 text-sm" />
        </label>
      </div>

      <button
        type="button"
        disabled={!valid}
        onClick={submit}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}
