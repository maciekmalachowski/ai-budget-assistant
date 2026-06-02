"use client";

import { useState } from "react";
import type { ColumnMapping } from "@/lib/domain/types";
import { Select } from "@/components/ui/select";
import { ColumnMappingForm } from "@/components/import/column-mapping-form";

interface ImportSummary {
  inserted: number;
  duplicates: number;
  aiCategorized: number;
  rowCount: number;
  errors: { rowIndex: number; message: string }[];
}

type Step = "upload" | "map" | "done";

async function postImport(file: File, accountId: string, mapping?: ColumnMapping) {
  const form = new FormData();
  form.set("file", file);
  form.set("accountId", accountId);
  if (mapping) form.set("mapping", JSON.stringify(mapping));
  const res = await fetch("/api/import", { method: "POST", body: form });
  return (await res.json()) as
    | { status: "needs_mapping"; header: string[]; rowCount: number }
    | ({ status: "imported" } & ImportSummary)
    | { error: string };
}

export function ImportWizard({ accounts, defaultCurrency }: { accounts: { id: string; name: string }[]; defaultCurrency: string }) {
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mapping?: ColumnMapping) {
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postImport(file, accountId, mapping);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.status === "needs_mapping") {
        setHeader(result.header);
        setStep("map");
        return;
      }
      setSummary(result);
      setStep("done");
    } catch {
      setError("Upload failed — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setHeader([]);
    setSummary(null);
    setError(null);
  }

  if (accounts.length === 0) {
    return <p className="text-muted-foreground text-sm">Create an account in Settings before importing.</p>;
  }

  return (
    <div className="max-w-2xl">
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
          <label className="flex flex-col gap-1 text-sm">
            CSV file
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button
            type="button"
            disabled={!file || !accountId || busy}
            onClick={() => send()}
            className="self-start rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Continue"}
          </button>
        </div>
      )}

      {step === "map" && (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">New bank layout — map its columns once and we&apos;ll remember it.</p>
          <ColumnMappingForm header={header} defaultCurrency={defaultCurrency} onSubmit={(mapping) => void send(mapping)} />
        </div>
      )}

      {step === "done" && summary && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Import complete</h2>
          <ul className="text-sm">
            <li>Imported: {summary.inserted}</li>
            <li>Duplicates skipped: {summary.duplicates}</li>
            <li>AI-categorized: {summary.aiCategorized}</li>
            <li>Rows in file: {summary.rowCount}</li>
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
