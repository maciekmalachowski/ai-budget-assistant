"use client";

import { useState, useTransition } from "react";
import type { ImportProfileSummary } from "@/lib/repos/imports";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteProfileAction } from "@/app/(app)/settings/actions";

export function ImportProfilesSection({ profiles }: { profiles: ImportProfileSummary[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(id: string) {
    setError(null);
    start(async () => {
      const res = await deleteProfileAction({ id });
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">Saved bank layouts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {profiles.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None yet. The first time you map an unknown CSV, its layout is saved here for next time.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="flex-1 truncate font-mono text-xs" title={p.headerSignature}>
                  {p.headerSignature}
                </span>
                <span className="text-muted-foreground w-28 text-right text-xs">
                  {p.encoding ?? "?"} · {p.delimiter ? `"${p.delimiter}"` : "?"}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(p.id)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  aria-label="Delete saved layout"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
