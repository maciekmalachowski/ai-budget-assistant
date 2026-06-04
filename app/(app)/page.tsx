import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/dashboard/data";
import { listCategories } from "@/lib/repos/categories";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { CategoryDonut } from "@/components/charts/category-donut";
import { TrendChart } from "@/components/charts/trend-chart";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { currentMonth } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = createAdminClient();
  const [data, categories] = await Promise.all([
    getDashboardData(db, { month: currentMonth() }),
    listCategories(db),
  ]);
  const colorByName = Object.fromEntries(
    categories.map((c) => [c.name, c.color]),
  ) as Record<string, string | null>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <KpiCards
        spentThisMonthMinor={data.spentThisMonthMinor}
        spentLastMonthMinor={data.spentLastMonthMinor}
        topCategory={data.topCategory}
        currency={data.currency}
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
