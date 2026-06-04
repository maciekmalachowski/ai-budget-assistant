"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
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
  // Recharts needs positive magnitudes; spend is stored negative.
  const slices = data.map((d) => ({ name: d.category, value: Math.abs(d.spentMinor) }));

  if (slices.length === 0) {
    return <p className="text-muted-foreground flex h-64 items-center justify-center text-sm">No spending this month.</p>;
  }

  const colorFor = (name: string, i: number) => categoryColor(name, i, colorByName);

  return (
    <div className="flex flex-col gap-3">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
              {slices.map((s, i) => (
                <Cell key={s.name} fill={colorFor(s.name, i)} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => (typeof value === "number" ? formatMoneyMinor(-value, currency) : String(value))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(s.name, i) }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground">{formatMoneyMinor(-s.value, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
