"use client";

import { Fragment, useMemo, useState } from "react";
import type { ColumnMapping, DateFormat, SupportedEncoding } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";
import { buildMapping, mappingToRoles, type ColumnRole } from "@/lib/csv/roles";
import { cn } from "@/lib/utils";

const DATE_FORMATS: DateFormat[] = ["DD-MM-YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
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

export interface ImportPreviewProps {
  columns: number;
  sampleRows: string[][];
  totalRows: number;
  initialMapping: ColumnMapping;
  initialStartRow: number;
  encoding: SupportedEncoding;
  defaultCurrency: string;
  busy: boolean;
  detected: boolean;
  onImport: (mapping: ColumnMapping, startRow: number) => void;
  onEncodingChange: (encoding: SupportedEncoding) => void;
  onBack: () => void;
}

export function ImportPreview(props: ImportPreviewProps) {
  const { columns, sampleRows, totalRows, initialMapping, initialStartRow, encoding, defaultCurrency, busy, detected } = props;
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
        Each column&apos;s dropdown sets its role. For transfers, set the payee column to
        <strong> Counterparty</strong> so names aren&apos;t lost. Click a row to mark where transactions
        start — rows above it (account info, headers) are skipped.
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
                <Fragment key={ri}>
                  {ri === startRow && startRow > 0 && (
                    <tr aria-hidden>
                      <td
                        colSpan={columns + 1}
                        className="border-t border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                      >
                        Transactions start here
                      </td>
                    </tr>
                  )}
                  <tr
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {sampleRows.length} of {totalRows} rows · importing from row {startRow + 1} onward.
      </p>

      {!detected && (
        <p className="text-xs text-amber-400">
          Couldn&apos;t auto-detect where transactions start — click the first real transaction row above.
        </p>
      )}

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
