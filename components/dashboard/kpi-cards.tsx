import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoneyMinor } from "@/lib/format";
import { deltaPct } from "@/lib/queries/aggregate";

export function KpiCards({
  spentThisMonthMinor,
  spentLastMonthMinor,
  netThisMonthMinor,
  savingsRatePct,
  projectedMonthEndMinor,
  avgDailySpendMinor,
  currency,
  locale,
}: {
  spentThisMonthMinor: number;
  spentLastMonthMinor: number;
  netThisMonthMinor: number;
  savingsRatePct: number | null;
  projectedMonthEndMinor: number;
  avgDailySpendMinor: number;
  currency: string;
  locale?: string;
}) {
  const fmt = (m: number) => formatMoneyMinor(m, currency, locale);
  const pct = deltaPct(Math.abs(spentLastMonthMinor), Math.abs(spentThisMonthMinor));
  // Spending up vs last month is "bad" (red); down is "good" (green).
  const pctTone = pct === null ? "" : pct > 0 ? "text-red-400" : "text-emerald-400";
  const saved = netThisMonthMinor >= 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <CardContent className={`text-2xl font-semibold ${pctTone}`}>
          {pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{saved ? "Net saved" : "Net overspent"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-semibold ${saved ? "text-emerald-400" : "text-red-400"}`}>
            {fmt(Math.abs(netThisMonthMinor))}
          </div>
          <div className="text-muted-foreground text-sm">
            {savingsRatePct === null ? "no income yet" : `${savingsRatePct}% of income`}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projected month-end</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{fmt(Math.abs(projectedMonthEndMinor))}</div>
          <div className="text-muted-foreground text-sm">{fmt(Math.abs(avgDailySpendMinor))}/day avg</div>
        </CardContent>
      </Card>
    </div>
  );
}
