import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importTooLarge, MAX_IMPORT_BYTES } from "@/lib/import/limits";
import { parseCsvMatrixBuffer } from "@/lib/csv/parse";
import { layoutSignature } from "@/lib/csv/profile";
import { getProfileBySignature } from "@/lib/repos/imports";
import { guessMapping, detectStartRow } from "@/lib/csv/detect";
import type { SupportedEncoding } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_ROWS = 15;
const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "PLN";

function readEncoding(form: FormData): SupportedEncoding | undefined {
  const raw = form.get("encoding");
  return raw === "utf-8" || raw === "win1250" ? raw : undefined;
}

/**
 * Read-only preview for the import wizard. Parses a headerless CSV, auto-guesses
 * the positional column mapping + where transactions start (skipping any
 * account-info preamble), and returns a sample for the editable grid. No writes.
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "'file' is required" }, { status: 400 });
  }
  if (importTooLarge(file.size)) {
    return NextResponse.json(
      { error: `File too large. Maximum ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { columns, rows, encoding, delimiter } = parseCsvMatrixBuffer(buf, { encoding: readEncoding(form) });

  if (columns === 0 || rows.length === 0) {
    return NextResponse.json({ error: "No data found in the file." }, { status: 422 });
  }

  const db = createAdminClient();
  const profile = await getProfileBySignature(db, layoutSignature(columns, delimiter));
  const mapping = profile?.columnMapping ?? guessMapping(rows, columns, DEFAULT_CURRENCY);
  const startRow = detectStartRow(rows, mapping);

  return NextResponse.json({
    status: "preview",
    columns,
    sampleRows: rows.slice(0, PREVIEW_ROWS),
    totalRows: rows.length,
    encoding,
    delimiter,
    guess: { startRow, mapping },
    hasSavedProfile: profile !== null,
  });
}
