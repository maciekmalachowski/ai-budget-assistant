"use client";

import { useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/ui/markdown";
import { formatMoneyMinor, shortMonthLabel } from "@/lib/format";
import type { InsightStatPack } from "@/lib/ai/insights";

interface InsightResponse {
  period: string;
  summaryMd: string;
  stats: InsightStatPack;
  cached: boolean;
}

function monthLabel(period: string): string {
  return `${shortMonthLabel(period)} ${period.slice(0, 4)}`;
}

export function InsightsView({ months, defaultPeriod }: { months: string[]; defaultPeriod: string }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const [data, setData] = useState<InsightResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id: a response is applied only if it's still the latest
  // request. Changing the period (below) also bumps this so an in-flight fetch
  // for the old month can't land against the new selection.
  const reqId = useRef(0);

  async function generate() {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?period=${period}`);
      const json = (await res.json()) as InsightResponse | { error: string };
      if (id !== reqId.current) return; // superseded by a newer request / period change
      if (!res.ok || "error" in json) {
        setError(("error" in json && json.error) || "Could not generate insights.");
        setData(null);
      } else {
        setData(json);
      }
    } catch {
      if (id === reqId.current) setError("Couldn't reach the server. Try again.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  const stats = data?.stats;
  const currency = stats?.currency ?? "PLN";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={period}
          onChange={(e) => {
            reqId.current++; // invalidate any in-flight request for the old period
            setPeriod(e.target.value);
            setData(null);
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="bg-foreground text-background rounded-md px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Generating…" : data ? "Refresh" : "Generate insights"}
        </button>
        {data?.cached ? <span className="text-muted-foreground text-xs">cached</span> : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!data && !loading && !error ? (
        <p className="text-muted-foreground text-sm">
          Pick a month and generate a short AI summary of your spending.
        </p>
      ) : null}

      {stats ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Summary — {stats.periodLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <Markdown>{data!.summaryMd}</Markdown>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Totals</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span>Spent</span>
                  <span className="font-medium">{formatMoneyMinor(stats.totalSpentMinor, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Income</span>
                  <span className="text-emerald-600 font-medium">
                    {formatMoneyMinor(stats.totalIncomeMinor, currency)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top merchants</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {stats.topMerchants.length === 0 ? (
                  <span className="text-muted-foreground">No spending.</span>
                ) : (
                  stats.topMerchants.map((m) => (
                    <div key={m.merchant} className="flex justify-between">
                      <span>{m.merchant}</span>
                      <span className="font-medium">{formatMoneyMinor(m.spentMinor, currency)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Biggest changes vs last month</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {stats.vsPrevious.length === 0 ? (
                  <span className="text-muted-foreground">No comparable categories.</span>
                ) : (
                  stats.vsPrevious
                    .slice()
                    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
                    .slice(0, 5)
                    .map((c) => (
                      <div key={c.category} className="flex justify-between">
                        <span>{c.category}</span>
                        <span className={c.deltaPct >= 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>
                          {c.deltaPct >= 0 ? "+" : ""}
                          {c.deltaPct}%
                        </span>
                      </div>
                    ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>New merchants</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {stats.newMerchants.length === 0 ? (
                  <span className="text-muted-foreground">None.</span>
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    {stats.newMerchants.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
