import { parsePeriod } from "@/lib/queries/period";

/**
 * Coerce an untrusted `?month=` param into a valid "YYYY-MM" month, or the fallback.
 * Rejects malformed strings and out-of-range months (parsePeriod throws on month 00/13).
 * Pure — no I/O.
 */
export function safeMonth(month: string | undefined, fallback: string): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return fallback;
  try {
    parsePeriod(month);
    return month;
  } catch {
    return fallback;
  }
}

/**
 * The month options for the dashboard picker: every "YYYY-MM" month that has data,
 * plus the current month and the currently-selected month (so an empty current month
 * or a deep-linked empty month still appears), deduped and sorted newest-first.
 * Pure — no I/O.
 */
export function dashboardMonthOptions(distinct: string[], current: string, selected: string): string[] {
  const set = new Set<string>([current, selected, ...distinct]);
  return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
