import type { TxnListItem } from "@/lib/repos/transactions";
import { formatMoneyMinor } from "@/lib/format";

export function RecentTransactions({ items, currency }: { items: TxnListItem[]; currency: string }) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No transactions yet. Import a CSV from the Import tab to get started.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-4 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">{t.merchant ?? t.rawDescription}</div>
            <div className="text-muted-foreground text-xs">
              {t.bookedAt}
              {t.category ? ` · ${t.category}` : ""}
            </div>
          </div>
          <div className={t.amountMinor < 0 ? "" : "text-emerald-400"}>
            {formatMoneyMinor(t.amountMinor, currency)}
          </div>
        </li>
      ))}
    </ul>
  );
}
