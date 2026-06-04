"use client";

import { useState, useTransition } from "react";
import type { TxnListItem } from "@/lib/repos/transactions";
import { correctCategory } from "@/app/(app)/transactions/actions";
import { formatMoneyMinor } from "@/lib/format";
import { Select } from "@/components/ui/select";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/import/ai-apply";
import { swatchColor } from "@/lib/colors";

function needsReview(t: TxnListItem): boolean {
  return t.categorySource === "uncategorized" || (t.categorySource === "ai" && (t.aiConfidence ?? 0) < AI_CONFIDENCE_THRESHOLD);
}

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

export function TransactionsTable({
  rows,
  categories,
  categoryColors,
}: {
  rows: TxnListItem[];
  categories: string[];
  categoryColors: Record<string, string | null>;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No transactions match these filters.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Merchant</th>
            <th className="py-2 pr-4 font-medium">Category</th>
            <th className="py-2 pr-4 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2 pr-4 whitespace-nowrap">{t.bookedAt}</td>
              <td className="py-2 pr-4">
                <div className="font-medium">{t.merchant ?? t.rawDescription}</div>
                {needsReview(t) ? <span className="text-xs text-amber-400">Needs review</span> : null}
              </td>
              <td className="py-2 pr-4">
                <CategoryCell row={t} categories={categories} categoryColors={categoryColors} />
              </td>
              <td className={cnAmount(t.amountMinor)}>{formatMoneyMinor(t.amountMinor, t.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cnAmount(amountMinor: number): string {
  return amountMinor < 0 ? "py-2 pr-4 text-right whitespace-nowrap" : "py-2 pr-4 text-right whitespace-nowrap text-emerald-400";
}
