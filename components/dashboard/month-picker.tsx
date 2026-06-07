"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { parsePeriod } from "@/lib/queries/period";

/** Single-month selector that scopes the dashboard via the `?month=YYYY-MM` search param. */
export function DashboardMonthPicker({ months, selected }: { months: string[]; selected: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(month: string) {
    const next = new URLSearchParams(params.toString());
    next.set("month", month);
    router.push(`/?${next.toString()}`);
  }

  return (
    <Select aria-label="Dashboard month" value={selected} onChange={(e) => onChange(e.target.value)}>
      {months.map((m) => (
        <option key={m} value={m}>
          {parsePeriod(m).label}
        </option>
      ))}
    </Select>
  );
}
