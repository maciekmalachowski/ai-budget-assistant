"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoneyMinor, shortMonthLabel } from "@/lib/format";

export function TrendChart({
  data,
  currency,
}: {
  data: { month: string; spentMinor: number }[];
  currency: string;
}) {
  const points = data.map((d) => ({ label: shortMonthLabel(d.month), spent: Math.abs(d.spentMinor) }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis hide />
          <Tooltip formatter={(value) => typeof value === "number" ? formatMoneyMinor(-value, currency) : value} />
          <Bar dataKey="spent" fill="#0a84ff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
