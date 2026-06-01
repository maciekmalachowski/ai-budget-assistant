"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoneyMinor } from "@/lib/format";

const COLORS = ["#0a84ff", "#34c759", "#ff9f0a", "#5e5ce6", "#ff375f", "#64d2ff", "#bf5af2", "#98989d"];

export function CategoryDonut({
  data,
  currency,
}: {
  data: { category: string; spentMinor: number }[];
  currency: string;
}) {
  // Recharts needs positive magnitudes; spend is stored negative.
  const slices = data.slice(0, COLORS.length).map((d) => ({ name: d.category, value: Math.abs(d.spentMinor) }));

  if (slices.length === 0) {
    return <p className="text-muted-foreground flex h-64 items-center justify-center text-sm">No spending this month.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
            {slices.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => typeof value === "number" ? formatMoneyMinor(-value, currency) : value} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
