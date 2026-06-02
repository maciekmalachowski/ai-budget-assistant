const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format signed integer minor units as a localized currency string (e.g. -482000 → "-$4,820.00"). */
export function formatMoneyMinor(amountMinor: number, currency: string, locale = "pl-PL"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);
}

/** The N consecutive months ending at `endMonth` ("YYYY-MM"), oldest → newest. Throws on a bad month. */
export function lastNMonths(endMonth: string, n: number): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(endMonth.trim());
  if (!m) throw new Error(`Not a month: ${endMonth}`);
  let year = Number(m[1]);
  let mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error(`Invalid month: ${endMonth}`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${year}-${String(mon).padStart(2, "0")}`);
    mon -= 1;
    if (mon === 0) {
      mon = 12;
      year -= 1;
    }
  }
  return out;
}

/** Short month name for a "YYYY-MM" (e.g. "May"). Throws on a bad month. */
export function shortMonthLabel(month: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(month.trim());
  if (!m) throw new Error(`Not a month: ${month}`);
  const idx = Number(m[1]) - 1;
  if (idx < 0 || idx > 11) throw new Error(`Invalid month: ${month}`);
  return SHORT_MONTHS[idx];
}

/** The current month as "YYYY-MM" (UTC). Pass a fixed Date in tests for determinism. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
