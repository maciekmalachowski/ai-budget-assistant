"use client";

import { useState } from "react";
import type { ColumnMapping, SupportedEncoding } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";
import { ImportDropzone } from "@/components/import/import-dropzone";
import { ImportPreview } from "@/components/import/import-preview";

interface ImportSummary {
  inserted: number;
  duplicates: number;
  aiCategorized: number;
  rowCount: number;
  errors: { rowIndex: number; message: string }[];
}

interface PreviewData {
  columns: number;
  sampleRows: string[][];
  totalRows: number;
  encoding: SupportedEncoding;
  delimiter: string;
  guess: { startRow: number; mapping: ColumnMapping };
  hasSavedProfile: boolean;
}

type Step = "upload" | "preview" | "done";

export function ImportWizard({
  accounts,
  defaultCurrency,
}: {
  accounts: { id: string; name: string }[];
  defaultCurrency: string;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadPreview(f: File, encoding?: SupportedEncoding) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", f);
      if (encoding) form.set("encoding", encoding);
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      const data = (await res.json()) as PreviewData | { error: string };
      if ("error" in data) {
        setError(data.error);
        return;
      }
      setPreview(data);
      setStep("preview");
    } catch {
      setError("Couldn't read that file — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onFile(f: File) {
    setFile(f);
    void loadPreview(f);
  }

  function changeEncoding(encoding: SupportedEncoding) {
    if (file) void loadPreview(file, encoding);
  }

  async function doImport(mapping: ColumnMapping, startRow: number) {
    if (!file || !accountId || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("accountId", accountId);
      form.set("mapping", JSON.stringify(mapping));
      form.set("startRow", String(startRow));
      form.set("encoding", preview.encoding);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = (await res.json()) as ({ status: "imported" } & ImportSummary) | { error: string };
      if ("error" in data) {
        setError(data.error);
        return;
      }
      setSummary(data);
      setStep("done");
    } catch {
      setError("Import failed — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setSummary(null);
    setError(null);
  }

  if (accounts.length === 0) {
    return <p className="text-muted-foreground text-sm">Create an account in Settings before importing.</p>;
  }

  return (
    <div className="max-w-3xl">
      {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}

      {step === "upload" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Account
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </label>
          <ImportDropzone onFile={onFile} disabled={busy} />
          {busy && <p className="text-sm text-muted-foreground">Reading file…</p>}
        </div>
      )}

      {step === "preview" && preview && (
        <ImportPreview
          columns={preview.columns}
          sampleRows={preview.sampleRows}
          totalRows={preview.totalRows}
          initialMapping={preview.guess.mapping}
          initialStartRow={preview.guess.startRow}
          encoding={preview.encoding}
          defaultCurrency={defaultCurrency}
          busy={busy}
          onImport={doImport}
          onEncodingChange={changeEncoding}
          onBack={reset}
        />
      )}

      {step === "done" && summary && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Import complete</h2>
          <ul className="text-sm">
            <li>Imported: {summary.inserted}</li>
            <li>Duplicates skipped: {summary.duplicates}</li>
            <li>AI-categorized: {summary.aiCategorized}</li>
            <li>Rows processed: {summary.rowCount}</li>
            {summary.errors.length > 0 ? (
              <li className="text-amber-400">Rows skipped (parse errors): {summary.errors.length}</li>
            ) : null}
          </ul>
          <button type="button" onClick={reset} className="self-start rounded-md border px-4 py-2 text-sm">
            Import another
          </button>
        </div>
      )}
    </div>
  );
}
