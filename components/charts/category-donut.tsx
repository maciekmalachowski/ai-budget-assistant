"use client";

import "@/components/charts/chart-setup";
import { Doughnut } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import { formatMoneyMinor } from "@/lib/format";
import { categoryColor } from "@/lib/colors";

export function CategoryDonut({
  data,
  currency,
  colorByName = {},
}: {
  data: { category: string; spentMinor: number }[];
  currency: string;
  colorByName?: Record<string, string | null>;
}) {
  // Chart.js needs positive magnitudes; spend is stored negative.
  const slices = data.map((d) => ({ name: d.category, value: Math.abs(d.spentMinor) }));

  if (slices.length === 0) {
    return <p className="text-muted-foreground flex h-64 items-center justify-center text-sm">No spending this month.</p>;
  }

  const colors = slices.map((s, i) => categoryColor(s.name, i, colorByName));

  const chartData: ChartData<"doughnut", number[], string> = {
    labels: slices.map((s) => s.name),
    datasets: [{ data: slices.map((s) => s.value), backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
  };

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.label}: ${formatMoneyMinor(Number(ctx.parsed), currency)}` },
      },
    },
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="h-64 w-full">
        <Doughnut data={chartData} options={options} />
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: colors[i] }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground">{formatMoneyMinor(s.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
