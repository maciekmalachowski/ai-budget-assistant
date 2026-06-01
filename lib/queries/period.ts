const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface PeriodBounds {
  /** Inclusive start date, "YYYY-MM-DD". */
  fromISO: string;
  /** Inclusive end date, "YYYY-MM-DD". */
  toISO: string;
  /** Human label, e.g. "May 2026" or "2026-05-03 to 2026-05-10". */
  label: string;
}

/**
 * Parse a period string into inclusive date bounds. Accepts a whole month
 * ("YYYY-MM") or an inclusive day range ("YYYY-MM-DD..YYYY-MM-DD"). Throws on
 * anything else, an out-of-range month, or a backwards range.
 */
export function parsePeriod(period: string): PeriodBounds {
  const trimmed = period.trim();

  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) {
    const year = Number(month[1]);
    const mon = Number(month[2]); // 1..12
    if (mon < 1 || mon > 12) throw new Error(`Invalid month in period: ${period}`);
    // Day 0 of the following month (1-indexed) = last day of this month.
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const mm = String(mon).padStart(2, "0");
    return {
      fromISO: `${year}-${mm}-01`,
      toISO: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
      label: `${MONTHS[mon - 1]} ${year}`,
    };
  }

  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (range) {
    const [, from, to] = range;
    if (from > to) throw new Error(`Period start after end: ${period}`);
    return { fromISO: from, toISO: to, label: `${from} to ${to}` };
  }

  throw new Error(`Unrecognized period format: ${period}`);
}

/** The "YYYY-MM" month immediately before a "YYYY-MM" month. Throws if not a month. */
export function previousMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) throw new Error(`Not a month: ${month}`);
  let year = Number(m[1]);
  let mon = Number(m[2]) - 1;
  if (mon === 0) {
    mon = 12;
    year -= 1;
  }
  return `${year}-${String(mon).padStart(2, "0")}`;
}
