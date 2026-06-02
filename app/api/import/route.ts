import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importTooLarge, MAX_IMPORT_BYTES } from "@/lib/import/limits";
import { getAnthropicClient } from "@/lib/ai/client";
import { parseCsvBuffer } from "@/lib/csv/parse";
import { headerSignature } from "@/lib/csv/profile";
import { getProfileBySignature, saveProfile } from "@/lib/repos/imports";
import { runImport } from "@/lib/import/run";
import type { ColumnMapping } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import a CSV. Multipart form-data: `file` (the CSV), `accountId`, and optional
 * `mapping` (a JSON ColumnMapping). Mapping resolution: an explicit mapping wins
 * and is saved as the bank's profile; otherwise a known profile (matched by
 * header signature) is restored; otherwise we return `needs_mapping` with the
 * parsed header so the client can present the mapping step (Phase 6 wizard).
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
  if (!(file instanceof File) || typeof accountId !== "string" || !accountId) {
    return NextResponse.json({ error: "'file' and 'accountId' are required" }, { status: 400 });
  }

  if (importTooLarge(file.size)) {
    return NextResponse.json(
      { error: `File too large. Maximum ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { header, rows, encoding, delimiter } = parseCsvBuffer(buf);
  const signature = headerSignature(header);
  const db = createAdminClient();

  let mapping: ColumnMapping;
  const mappingRaw = form.get("mapping");
  if (typeof mappingRaw === "string" && mappingRaw.length > 0) {
    try {
      mapping = JSON.parse(mappingRaw) as ColumnMapping;
    } catch {
      return NextResponse.json({ error: "'mapping' must be valid JSON" }, { status: 400 });
    }
    await saveProfile(db, {
      headerSignature: signature,
      columnMapping: mapping,
      dateFormat: mapping.dateFormat,
      delimiter,
      decimalSep: mapping.decimalSep,
      encoding,
    });
  } else {
    const profile = await getProfileBySignature(db, signature);
    if (!profile) {
      return NextResponse.json({ status: "needs_mapping", header, rowCount: rows.length, encoding, delimiter }, { status: 200 });
    }
    mapping = profile.columnMapping;
  }

  try {
    const summary = await runImport({ db, anthropic: getAnthropicClient() }, { accountId, rows, mapping, fileName: file.name });
    return NextResponse.json({ status: "imported", ...summary });
  } catch {
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }
}
