import { InsightsView } from "@/components/insights/insights-view";
import { currentMonth, lastNMonths } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  const month = currentMonth();
  const months = lastNMonths(month, 12).slice().reverse(); // newest first for the dropdown

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Insights</h1>
      <InsightsView months={months} defaultPeriod={month} />
    </div>
  );
}
