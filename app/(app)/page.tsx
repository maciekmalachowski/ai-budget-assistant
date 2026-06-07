import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/dashboard/data";
import { dashboardMonthOptions, safeMonth } from "@/lib/dashboard/months";
import { listCategories } from "@/lib/repos/categories";
import { getDistinctMonths } from "@/lib/repos/transactions";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { DashboardMonthPicker } from "@/components/dashboard/month-picker";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { CategoryDonut } from "@/components/charts/category-donut";
import { TrendChart } from "@/components/charts/trend-chart";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { currentMonth } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const current = currentMonth();
  const selected = safeMonth(sp.month, current);
  const isCurrentMonth = selected === current;

  const db = createAdminClient();
  const [data, categories, distinctMonths] = await Promise.all([
    getDashboardData(db, { month: selected }),
    listCategories(db),
    getDistinctMonths(db),
  ]);
  const months = dashboardMonthOptions(distinctMonths, current, selected);
  const colorByName = Object.fromEntries(
    categories.map((c) => [c.name, c.color]),
  ) as Record<string, string | null>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {/* useSearchParams() needs a Suspense boundary (harmless under force-dynamic, required if it's ever removed). */}
        <Suspense fallback={null}>
          <DashboardMonthPicker months={months} selected={selected} />
        </Suspense>
      </div>

      <KpiCards
        spentThisMonthMinor={data.spentThisMonthMinor}
        spentLastMonthMinor={data.spentLastMonthMinor}
        netThisMonthMinor={data.netThisMonthMinor}
        savingsRatePct={data.savingsRatePct}
        projectedMonthEndMinor={data.projectedMonthEndMinor}
        avgDailySpendMinor={data.avgDailySpendMinor}
        currency={data.currency}
        month={selected}
        isCurrentMonth={isCurrentMonth}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryDonut data={data.byCategory} currency={data.currency} colorByName={colorByName} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>6-month trend</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart data={data.trend} currency={data.currency} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentTransactions items={data.recent} currency={data.currency} />
        </CardContent>
      </Card>
    </div>
  );
}
