"use client";

import "@/components/charts/chart-setup";
import { Chart } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import { formatMoneyMinor } from "@/lib/format";
import { buildTrendModel } from "@/lib/charts/trend";
import type { TrendPoint } from "@/lib/dashboard/data";

const AXIS = "#9ca3af";
const GRID = "rgba(148,163,184,0.15)";

export function TrendChart({ data, currency }: { data: TrendPoint[]; currency: string }) {
  const m = buildTrendModel(data);

  // Diverging chart on a single zero-baseline axis: income bars up (+), spend bars DOWN (−),
  // net line signed. Sign-consistent so the line and bars share a meaningful scale, and an
  // overspending month reads as the net line crossing below zero.
  const chartData: ChartData<"bar" | "line", number[], string> = {
    labels: m.labels,
    datasets: [
      { type: "bar", label: "Income", data: m.income, backgroundColor: "rgba(16,185,129,0.75)", borderRadius: 4, order: 2 },
      { type: "bar", label: "Spent", data: m.spend.map((v) => -v), backgroundColor: "rgba(244,63,94,0.75)", borderRadius: 4, order: 2 },
      { type: "line", label: "Net", data: m.net, borderColor: "#0a84ff", backgroundColor: "#0a84ff", tension: 0.3, pointRadius: 3, order: 1 },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: AXIS, boxWidth: 12, boxHeight: 12 } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatMoneyMinor(Number(ctx.parsed.y), currency)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: AXIS } },
      y: {
        grid: { color: GRID },
        ticks: { color: AXIS, callback: (v) => formatMoneyMinor(Number(v), currency) },
      },
    },
  };

  return (
    <div className="h-64 w-full">
      {/* Combo chart: each dataset carries its own `type`, so cast to the base bar type. */}
      <Chart type="bar" data={chartData as ChartData<"bar", number[], string>} options={options} />
    </div>
  );
}
