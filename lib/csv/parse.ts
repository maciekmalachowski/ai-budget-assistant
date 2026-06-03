import Papa from "papaparse";
import iconv from "iconv-lite";
import type { RawRow, SupportedEncoding } from "@/lib/domain/types";

/** Guess the encoding: UTF-8 if it has a BOM or decodes cleanly, else Windows-1250. */
export function detectEncoding(buf: Buffer): SupportedEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return "utf-8";
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return "utf-8";
  } catch {
    return "win1250";
  }
}

/** Decode a CSV buffer to a string, detecting the encoding when not given. */
export function decodeBuffer(buf: Buffer, encoding?: SupportedEncoding): string {
  const enc = encoding ?? detectEncoding(buf);
  if (enc === "utf-8") {
    const text = buf.toString("utf-8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }
  return iconv.decode(buf, "win1250");
}

const DELIMITERS = [";", ",", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** Pick the delimiter that appears most often in the first (header) line. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best: Delimiter = DELIMITERS[0];
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export interface ParsedCsv {
  header: string[];
  rows: RawRow[];
}

/** Parse already-decoded CSV text with a known delimiter into header + keyed rows. */
export function parseCsv(text: string, delimiter: string): ParsedCsv {
  const result = Papa.parse<RawRow>(text, {
    header: true,
    delimiter,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const header = result.meta.fields ?? [];
  const rows = (result.data ?? []).filter((r) => Object.keys(r).length > 0);
  return { header, rows };
}

export interface ParseCsvBufferOptions {
  encoding?: SupportedEncoding;
  delimiter?: Delimiter;
}

export interface ParseCsvBufferResult extends ParsedCsv {
  encoding: SupportedEncoding;
  delimiter: Delimiter;
}

/** Full pipeline: detect/decode + detect delimiter + parse. */
export function parseCsvBuffer(buf: Buffer, opts: ParseCsvBufferOptions = {}): ParseCsvBufferResult {
  const encoding = opts.encoding ?? detectEncoding(buf);
  const text = decodeBuffer(buf, encoding);
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const { header, rows } = parseCsv(text, delimiter);
  return { header, rows, encoding, delimiter };
}

/** Stable synthetic key for the Nth (0-based) column of a headerless file. */
export function columnKey(index: number): string {
  return `Column ${index + 1}`;
}

/** Inverse of columnKey: "Column 6" → 5; -1 when the key is not synthetic. */
export function columnIndex(key: string): number {
  const m = /^Column (\d+)$/.exec(key);
  return m ? Number(m[1]) - 1 : -1;
}

export interface CsvMatrix {
  /** Max column count across all rows. */
  columns: number;
  /** Every row padded to `columns` cells (missing cells become ""). */
  rows: string[][];
}

/** Parse decoded CSV text with no header row into a padded matrix of raw string cells. */
export function parseCsvMatrix(text: string, delimiter: string): CsvMatrix {
  const result = Papa.parse<string[]>(text, {
    header: false,
    delimiter,
    skipEmptyLines: "greedy",
  });
  const data = (result.data ?? []).filter((r): r is string[] => Array.isArray(r));
  const columns = data.reduce((max, r) => Math.max(max, r.length), 0);
  const rows = data.map((r) => Array.from({ length: columns }, (_, i) => r[i] ?? ""));
  return { columns, rows };
}

export interface ParseMatrixResult extends CsvMatrix {
  encoding: SupportedEncoding;
  delimiter: Delimiter;
}

/** Full headerless pipeline: detect/decode + detect delimiter + parse into a matrix. */
export function parseCsvMatrixBuffer(buf: Buffer, opts: ParseCsvBufferOptions = {}): ParseMatrixResult {
  const encoding = opts.encoding ?? detectEncoding(buf);
  const text = decodeBuffer(buf, encoding);
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const { columns, rows } = parseCsvMatrix(text, delimiter);
  return { columns, rows, encoding, delimiter };
}

/** Convert a (sliced) matrix into RawRow objects keyed by synthetic column keys. */
export function matrixToRawRows(rows: string[][], columns: number): RawRow[] {
  return rows.map((cells) => {
    const row: RawRow = {};
    for (let i = 0; i < columns; i++) row[columnKey(i)] = cells[i] ?? "";
    return row;
  });
}
