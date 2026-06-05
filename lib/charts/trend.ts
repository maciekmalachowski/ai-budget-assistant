import type { TrendPoint } from "@/lib/dashboard/data";
import { shortMonthLabel } from "@/lib/format";

export interface TrendChartModel {
  labels: string[];
  /** Income per month (positive minor units). */
  income: number[];
  /** Spend per month as positive magnitudes (stored negative). */
  spend: number[];
  /** Net per month (signed minor units). */
  net: number[];
}

/** Shape the 6-month trend into parallel series for the income/spend/net chart. Pure. */
export function buildTrendModel(data: TrendPoint[]): TrendChartModel {
  return {
    labels: data.map((d) => shortMonthLabel(d.month)),
    income: data.map((d) => d.incomeMinor),
    spend: data.map((d) => Math.abs(d.spentMinor)),
    net: data.map((d) => d.netMinor),
  };
}
