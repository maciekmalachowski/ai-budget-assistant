import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatMoneyMinor } from "@/lib/format";
import { deltaPct } from "@/lib/queries/aggregate";
import { parsePeriod, previousMonth } from "@/lib/queries/period";

export function KpiCards({
  spentThisMonthMinor,
  spentLastMonthMinor,
  netThisMonthMinor,
  savingsRatePct,
  projectedMonthEndMinor,
  avgDailySpendMinor,
  currency,
  locale,
  month,
  isCurrentMonth = true,
}: {
  spentThisMonthMinor: number;
  spentLastMonthMinor: number;
  netThisMonthMinor: number;
  savingsRatePct: number | null;
  projectedMonthEndMinor: number;
  avgDailySpendMinor: number;
  currency: string;
  locale?: string;
  /** The "YYYY-MM" month these figures cover (drives past-month labels). */
  month?: string;
  /** When false, the figures are a completed past month: relabel and show the actual total, not a run-rate projection. */
  isCurrentMonth?: boolean;
}) {
  const fmt = (m: number) => formatMoneyMinor(m, currency, locale);
  const pct = deltaPct(Math.abs(spentLastMonthMinor), Math.abs(spentThisMonthMinor));
  // Spending up vs last month is "bad" (red); down is "good" (green).
  const pctTone = pct === null ? "" : pct > 0 ? "text-red-400" : "text-emerald-400";
  const saved = netThisMonthMinor >= 0;

  // For a past month, label cards with the actual month and swap the run-rate projection
  // (meaningless once the month is over) for the real total.
  const spentTitle = isCurrentMonth || !month ? "Spent this month" : `Spent in ${parsePeriod(month).label}`;
  const vsTitle = isCurrentMonth || !month ? "vs last month" : `vs ${parsePeriod(previousMonth(month)).label}`;
  const lastCardTitle = isCurrentMonth ? "Projected month-end" : "Month total";
  const lastCardValue = isCurrentMonth ? projectedMonthEndMinor : spentThisMonthMinor;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle>{spentTitle}</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{fmt(Math.abs(spentThisMonthMinor))}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{vsTitle}</CardTitle>
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
          <CardTitle>{lastCardTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{fmt(Math.abs(lastCardValue))}</div>
          <div className="text-muted-foreground text-sm">{fmt(Math.abs(avgDailySpendMinor))}/day avg</div>
        </CardContent>
      </Card>
    </div>
  );
}
