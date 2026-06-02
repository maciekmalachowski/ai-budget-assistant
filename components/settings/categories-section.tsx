"use client";

import { useState, useTransition } from "react";
import type { CategoryWithCount, Category } from "@/lib/repos/categories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  createCategoryAction,
  deleteCategoryAction,
  recolorCategoryAction,
  renameCategoryAction,
} from "@/app/(app)/settings/actions";

const KINDS: Category["kind"][] = ["expense", "income", "transfer"];

export function CategoriesSection({ categories }: { categories: CategoryWithCount[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [color, setColor] = useState("#0a84ff");

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
        <CardTitle className="text-foreground text-base">Categories</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <input
                type="color"
                defaultValue={c.color ?? "#888888"}
                disabled={pending}
                // Commit once when the picker closes — `onChange` fires on every drag tick,
                // which would fire a DB write + revalidate per tick.
                onBlur={(e) => {
                  if (e.target.value !== (c.color ?? "#888888")) {
                    run(() => recolorCategoryAction({ id: c.id, color: e.target.value }));
                  }
                }}
                className="h-8 w-10 rounded border"
                aria-label={`Color for ${c.name}`}
              />
              <input
                defaultValue={c.name}
                disabled={pending || c.isSystem}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) run(() => renameCategoryAction({ id: c.id, name: v }));
                }}
                className="h-9 flex-1 rounded-md border bg-background px-3 text-sm disabled:opacity-60"
                aria-label={`Category name for ${c.name}`}
              />
              <span className="text-muted-foreground w-32 text-right text-xs">
                {c.kind} · {c.transactionCount} txns
              </span>
              {c.isSystem ? (
                <span className="text-muted-foreground w-16 text-center text-xs">system</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (c.transactionCount > 0 && !window.confirm(`Delete "${c.name}"? ${c.transactionCount} transactions will become uncategorized.`)) {
                      return;
                    }
                    run(() => deleteCategoryAction({ id: c.id }));
                  }}
                  className="w-16 rounded-md border px-2 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  aria-label={`Delete category ${c.name}`}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(async () => {
              const res = await createCategoryAction({ name, kind, color });
              if (res.ok) setName("");
              return res;
            });
          }}
          className="flex flex-wrap items-center gap-2 border-t pt-4"
        >
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={pending}
            className="h-9 w-10 rounded border"
            aria-label="New category color"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name"
            disabled={pending}
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
          />
          <Select value={kind} onChange={(e) => setKind(e.target.value as Category["kind"])} disabled={pending}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            Add category
          </button>
        </form>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
