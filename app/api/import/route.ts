import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importTooLarge, MAX_IMPORT_BYTES } from "@/lib/import/limits";
import { getAnthropicClient } from "@/lib/ai/client";
import { parseCsvMatrixBuffer, matrixToRawRows } from "@/lib/csv/parse";
import type { Delimiter } from "@/lib/csv/parse";
import { layoutSignature } from "@/lib/csv/profile";
import { saveProfile } from "@/lib/repos/imports";
import { runImport } from "@/lib/import/run";
import type { ColumnMapping, SupportedEncoding } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readEncoding(form: FormData): SupportedEncoding | undefined {
  const raw = form.get("encoding");
  return raw === "utf-8" || raw === "win1250" ? raw : undefined;
}

function readDelimiter(form: FormData): Delimiter | undefined {
  const raw = form.get("delimiter");
  return raw === ";" || raw === "," || raw === "\t" ? raw : undefined;
}

/**
 * Commit a CSV import. Multipart form-data: `file`, `accountId`, `mapping`
 * (JSON ColumnMapping over synthetic positional columns), `startRow` (count of
 * leading non-transaction preamble rows to drop), and an optional `encoding`
 * echoed from the preview. Parses headerless, drops the preamble, runs the
 * pipeline, then remembers the bank's positional layout for next time.
 */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  const accountId = form.get("accountId");
  const mappingRaw = form.get("mapping");
  if (!(file instanceof File) || typeof accountId !== "string" || !accountId || typeof mappingRaw !== "string") {
    return NextResponse.json({ error: "'file', 'accountId', and 'mapping' are required" }, { status: 400 });
  }
  if (importTooLarge(file.size)) {
    return NextResponse.json(
      { error: `File too large. Maximum ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }

  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(mappingRaw) as ColumnMapping;
  } catch {
    return NextResponse.json({ error: "'mapping' must be valid JSON" }, { status: 400 });
  }

  const startRowRaw = form.get("startRow");
  const startRow = typeof startRowRaw === "string" ? Math.max(0, parseInt(startRowRaw, 10) || 0) : 0;

  const buf = Buffer.from(await file.arrayBuffer());
  const { columns, rows, delimiter, encoding } = parseCsvMatrixBuffer(buf, {
    encoding: readEncoding(form),
    delimiter: readDelimiter(form),
  });
  const dataRows = matrixToRawRows(rows.slice(startRow), columns);

  const db = createAdminClient();

  let summary;
  try {
    summary = await runImport(
      { db, anthropic: getAnthropicClient() },
      { accountId, rows: dataRows, mapping, fileName: file.name },
    );
  } catch {
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }

  // The layout profile is a convenience cache — a failed save must not fail a completed import.
  try {
    await saveProfile(db, {
      headerSignature: layoutSignature(columns, delimiter),
      columnMapping: mapping,
      dateFormat: mapping.dateFormat,
      delimiter,
      decimalSep: mapping.decimalSep,
      encoding,
    });
  } catch {
    // ignore: transactions are already imported
  }

  return NextResponse.json({ status: "imported", ...summary });
}
