import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UsageStats } from "@/lib/settings/usage";

/** Read-only view of the configured models + cumulative AI usage. Server component:
 *  model IDs come from server-only env, so they're passed down as props, never
 *  imported into a client bundle. */
export function AiConfigSection({
  models,
  usage,
}: {
  models: { categorize: string; qa: string; insights: string };
  usage: UsageStats;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Categorization model", value: models.categorize },
    { label: "Q&A model", value: models.qa },
    { label: "Insights model", value: models.insights },
    { label: "Questions asked", value: String(usage.qaCount) },
    { label: "Insights generated", value: String(usage.insightCount) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">AI &amp; usage</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-mono">{r.value}</span>
          </div>
        ))}
        <p className="text-muted-foreground mt-2 text-xs">
          Models are configured via environment variables (ANTHROPIC_MODEL_*). Restart the app to change them.
        </p>
      </CardContent>
    </Card>
  );
}
