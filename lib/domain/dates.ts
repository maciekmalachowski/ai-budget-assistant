import type { DateFormat } from "@/lib/domain/types";

const PATTERNS: Record<DateFormat, RegExp> = {
  "DD.MM.YYYY": /^(\d{2})\.(\d{2})\.(\d{4})$/,
  "DD-MM-YYYY": /^(\d{2})-(\d{2})-(\d{4})$/,
  "YYYY-MM-DD": /^(\d{4})-(\d{2})-(\d{2})$/,
  "DD/MM/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
  "MM/DD/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
};

/** Parse a date string in the given layout into ISO "YYYY-MM-DD". Throws if invalid. */
export function parseDate(raw: string, format: DateFormat): string {
  const m = PATTERNS[format].exec(raw.trim());
  if (!m) throw new Error(`Date "${raw}" does not match format ${format}`);

  let year: number;
  let month: number;
  let day: number;
  if (format === "YYYY-MM-DD") {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if (format === "MM/DD/YYYY") {
    month = Number(m[1]);
    day = Number(m[2]);
    year = Number(m[3]);
  } else {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  }

  if (month < 1 || month > 12) throw new Error(`Invalid month in "${raw}"`);
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) throw new Error(`Invalid day in "${raw}"`);

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const yyyy = String(year).padStart(4, "0");
  return `${yyyy}-${mm}-${dd}`;
}
