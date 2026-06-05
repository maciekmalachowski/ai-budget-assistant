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

/** Number of days in a "YYYY-MM" month. Throws if not a month. */
export function daysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) throw new Error(`Not a month: ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw new Error(`Invalid month: ${month}`);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/**
 * Days elapsed in `month` ("YYYY-MM") as of `todayISO` ("YYYY-MM-DD"):
 *  - a wholly-past month → the full day count,
 *  - a wholly-future month → 0,
 *  - the in-progress month → today's day-of-month (clamped to [0, daysInMonth]).
 * Lexical "YYYY-MM" comparison is correct for ordering.
 */
export function daysElapsed(month: string, todayISO: string): number {
  const dim = daysInMonth(month);
  const todayMonth = todayISO.slice(0, 7);
  if (todayMonth > month) return dim;
  if (todayMonth < month) return 0;
  const day = Number(todayISO.slice(8, 10));
  return Math.min(Math.max(Number.isFinite(day) ? day : 0, 0), dim);
}

/** The "YYYY-MM" month immediately before a "YYYY-MM" month. Throws if not a month. */
export function previousMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) throw new Error(`Not a month: ${month}`);
  const monthNum = Number(m[2]);
  if (monthNum < 1 || monthNum > 12) throw new Error(`Invalid month: ${month}`);
  let year = Number(m[1]);
  let mon = monthNum - 1;
  if (mon === 0) {
    mon = 12;
    year -= 1;
  }
  return `${year}-${String(mon).padStart(2, "0")}`;
}
