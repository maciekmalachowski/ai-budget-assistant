import type { Db } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { ColumnMapping } from "@/lib/domain/types";

/** Create an import batch row (status defaults to "pending"); returns its id. */
export async function createImportBatch(
  db: Db,
  input: {
    accountId: string;
    fileName?: string | null;
    storagePath?: string | null;
    columnMapping?: ColumnMapping | null;
    rowCount?: number;
    status?: "pending" | "mapped" | "imported" | "failed";
  },
): Promise<string> {
  const { data, error } = await db
    .from("import_batches")
    .insert({
      account_id: input.accountId,
      file_name: input.fileName ?? null,
      storage_path: input.storagePath ?? null,
      column_mapping: (input.columnMapping ?? null) as unknown as Json,
      row_count: input.rowCount ?? 0,
      status: input.status ?? "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Update a batch's counts + terminal status after an import run. */
export async function finalizeImportBatch(
  db: Db,
  batchId: string,
  result: { rowCount: number; importedCount: number; duplicateCount: number; status: "imported" | "failed" },
): Promise<void> {
  const { error } = await db
    .from("import_batches")
    .update({
      row_count: result.rowCount,
      imported_count: result.importedCount,
      duplicate_count: result.duplicateCount,
      status: result.status,
    })
    .eq("id", batchId);
  if (error) throw new Error(error.message);
}

export interface ImportProfile {
  id: string;
  columnMapping: ColumnMapping;
  dateFormat: string | null;
  delimiter: string | null;
  decimalSep: string | null;
  encoding: string | null;
}

/** Look up a saved bank layout by its header fingerprint, or null if unknown. */
export async function getProfileBySignature(db: Db, headerSignature: string): Promise<ImportProfile | null> {
  const { data, error } = await db
    .from("import_profiles")
    .select("id, column_mapping, date_format, delimiter, decimal_sep, encoding")
    .eq("header_signature", headerSignature)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    columnMapping: data.column_mapping as unknown as ColumnMapping,
    dateFormat: data.date_format,
    delimiter: data.delimiter,
    decimalSep: data.decimal_sep,
    encoding: data.encoding,
  };
}

/** Create or update a bank layout profile keyed by header signature; returns its id. */
export async function saveProfile(
  db: Db,
  input: {
    headerSignature: string;
    columnMapping: ColumnMapping;
    dateFormat?: string | null;
    delimiter?: string | null;
    decimalSep?: string | null;
    encoding?: string | null;
  },
): Promise<string> {
  const { data, error } = await db
    .from("import_profiles")
    .upsert(
      {
        header_signature: input.headerSignature,
        column_mapping: input.columnMapping as unknown as Json,
        date_format: input.dateFormat ?? null,
        delimiter: input.delimiter ?? null,
        decimal_sep: input.decimalSep ?? null,
        encoding: input.encoding ?? null,
      },
      { onConflict: "header_signature" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export interface ImportProfileSummary {
  id: string;
  headerSignature: string;
  delimiter: string | null;
  encoding: string | null;
  createdAt: string;
}

/** All saved bank-layout profiles, newest first (for the Settings page). */
export async function listProfiles(db: Db): Promise<ImportProfileSummary[]> {
  const { data, error } = await db
    .from("import_profiles")
    .select("id, header_signature, delimiter, encoding, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id,
    headerSignature: p.header_signature,
    delimiter: p.delimiter,
    encoding: p.encoding,
    createdAt: p.created_at,
  }));
}

/** Delete a saved bank-layout profile. */
export async function deleteProfile(db: Db, id: string): Promise<void> {
  const { error } = await db.from("import_profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
