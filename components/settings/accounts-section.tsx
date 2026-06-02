"use client";

import { useState, useTransition } from "react";
import type { AccountWithCount } from "@/lib/repos/accounts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createAccountAction,
  deleteAccountAction,
  renameAccountAction,
} from "@/app/(app)/settings/actions";

export function AccountsSection({ accounts }: { accounts: AccountWithCount[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("PLN");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">Accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <input
                defaultValue={a.name}
                disabled={pending}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== a.name) run(() => renameAccountAction({ id: a.id, name: v }));
                }}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                aria-label={`Account name for ${a.name}`}
              />
              <span className="text-muted-foreground w-28 text-right text-xs">
                {a.currency} · {a.transactionCount} txns
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteAccountAction({ id: a.id }))}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                aria-label={`Delete account ${a.name}`}
              >
                Delete
              </button>
            </li>
          ))}
          {accounts.length === 0 ? <li className="text-muted-foreground text-sm">No accounts yet.</li> : null}
        </ul>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(async () => {
              const res = await createAccountAction({ name, currency });
              if (res.ok) setName("");
              return res;
            });
          }}
          className="flex flex-wrap items-center gap-2 border-t pt-4"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New account name"
            disabled={pending}
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
          />
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="PLN"
            maxLength={3}
            disabled={pending}
            className="h-9 w-20 rounded-md border bg-background px-3 text-sm uppercase"
            aria-label="Currency"
          />
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            Add account
          </button>
        </form>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
