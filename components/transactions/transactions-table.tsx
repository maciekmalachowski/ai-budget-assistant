"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { TxnListItem } from "@/lib/repos/transactions";
import { correctCategory, deleteTransactions } from "@/app/(app)/transactions/actions";
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

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 cursor-pointer"
      checked={checked}
      aria-label="Select all transactions"
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function DeleteBar({
  count,
  onDeleted,
  onClear,
  ids,
}: {
  count: number;
  ids: string[];
  onDeleted: () => void;
  onClear: () => void;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="bg-card sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-3 border-b py-2">
      <span className="text-sm font-medium">{count} selected</span>
      {confirming ? (
        <>
          <span className="text-sm">Delete {count} transaction{count === 1 ? "" : "s"}? This can&apos;t be undone.</span>
          <button
            type="button"
            disabled={pending}
            className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await deleteTransactions({ ids });
                if (res.ok) {
                  setConfirming(false);
                  onDeleted();
                } else {
                  setError(res.error ?? "Delete failed");
                }
              });
            }}
          >
            {pending ? "Deleting…" : "Confirm delete"}
          </button>
          <button
            type="button"
            disabled={pending}
            className="text-muted-foreground text-sm hover:underline disabled:opacity-50"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="rounded border border-red-600 px-3 py-1 text-sm font-medium text-red-500 hover:bg-red-600/10"
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
          <button type="button" className="text-muted-foreground text-sm hover:underline" onClick={onClear}>
            Clear
          </button>
        </>
      )}
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No transactions match these filters.</p>;
  }

  // Keep selection consistent with the rows currently rendered (filters/revalidate can change them).
  const visibleIds = rows.map((r) => r.id);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(visibleIds) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
      {selectedVisible.length > 0 ? (
        <DeleteBar
          count={selectedVisible.length}
          ids={selectedVisible}
          onDeleted={() => setSelectedIds(new Set())}
          onClear={() => setSelectedIds(new Set())}
        />
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th scope="col" className="py-2 pr-4 font-medium">
              <SelectAllCheckbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} />
            </th>
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Merchant</th>
            <th className="py-2 pr-4 font-medium">Category</th>
            <th className="py-2 pr-4 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2 pr-4">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer"
                  checked={selectedIds.has(t.id)}
                  aria-label={`Select transaction ${t.merchant ?? t.rawDescription}`}
                  onChange={(e) => toggleOne(t.id, e.target.checked)}
                />
              </td>
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
