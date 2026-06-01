import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoneyMinor } from "@/lib/format";
import { deltaPct } from "@/lib/queries/aggregate";

export function KpiCards({
  spentThisMonthMinor,
  spentLastMonthMinor,
  topCategory,
  currency,
  locale,
}: {
  spentThisMonthMinor: number;
  spentLastMonthMinor: number;
  topCategory: { category: string; spentMinor: number } | null;
  currency: string;
  locale?: string;
}) {
  const fmt = (m: number) => formatMoneyMinor(m, currency, locale);
  const pct = deltaPct(Math.abs(spentLastMonthMinor), Math.abs(spentThisMonthMinor));

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Spent this month</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{fmt(Math.abs(spentThisMonthMinor))}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>vs last month</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">
          {pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top category</CardTitle>
        </CardHeader>
        <CardContent>
          {topCategory ? (
            <div>
              <div className="text-lg font-semibold">{topCategory.category}</div>
              <div className="text-muted-foreground text-sm">{fmt(Math.abs(topCategory.spentMinor))}</div>
            </div>
          ) : (
            <span className="text-2xl font-semibold">—</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
