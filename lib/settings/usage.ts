import type { Db } from "@/lib/supabase/admin";

export interface UsageStats {
  qaCount: number;
  insightCount: number;
}

/** Cheap COUNT(*) of logged Q&A interactions and cached insights (for the Settings page). */
export async function getUsageStats(db: Db): Promise<UsageStats> {
  const [qa, ins] = await Promise.all([
    db.from("qa_history").select("id", { count: "exact", head: true }),
    db.from("insights").select("id", { count: "exact", head: true }),
  ]);
  if (qa.error) throw new Error(qa.error.message);
  if (ins.error) throw new Error(ins.error.message);
  return { qaCount: qa.count ?? 0, insightCount: ins.count ?? 0 };
}
