"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/ui/select";

/** Search + category + needs-review filters that drive the page via URL search params. */
export function TransactionsFilters({ categories }: { categories: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("merchant") ?? "");

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/transactions?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParam("merchant", search.trim());
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search merchant…"
          className="h-9 w-56 rounded-md border bg-background px-3 text-sm"
        />
      </form>

      <Select value={params.get("category") ?? ""} onChange={(e) => setParam("category", e.target.value)}>
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={params.get("needsReview") === "1"}
          onChange={(e) => setParam("needsReview", e.target.checked ? "1" : "")}
        />
        Needs review
      </label>
    </div>
  );
}
