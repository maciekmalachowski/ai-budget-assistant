import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAnthropicClient } from "@/lib/ai/client";
import { getOrGenerateInsight } from "@/lib/insights/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM");

export async function GET(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = new URL(request.url).searchParams.get("period");
  const parsed = periodSchema.safeParse(period);
  if (!parsed.success) {
    return NextResponse.json({ error: "Query param 'period' must be YYYY-MM" }, { status: 400 });
  }

  const db = createAdminClient();
  try {
    const result = await getOrGenerateInsight({ db, anthropic: getAnthropicClient() }, { period: parsed.data });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not generate insights for that period." }, { status: 502 });
  }
}
