import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReadonlyClient } from "@/lib/supabase/readonly";
import { getAnthropicClient } from "@/lib/ai/client";
import { answerQuestion } from "@/lib/ai/qa";
import { createQueryTools, withReadonlyFallback } from "@/lib/queries/tools";
import { logQa } from "@/lib/repos/qaHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ question: z.string().min(1).max(1000) });

export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "A non-empty 'question' (<=1000 chars) is required" }, { status: 400 });
  }

  const writeDb = createAdminClient();
  // Prefer the SELECT-only readonly_qa role for reads; if minting that client fails
  // (e.g. SUPABASE_JWT_SECRET is missing), degrade to the admin client so Q&A still works.
  let readDb;
  try {
    readDb = createReadonlyClient();
  } catch (err) {
    console.error("[ask] readonly client unavailable, using admin for reads:", err instanceof Error ? err.message : err);
    readDb = writeDb;
  }

  try {
    // Each tool tries the readonly path first; on an infra/auth failure (rejected JWT,
    // missing role/policies) it transparently falls back to the admin client and logs why.
    const tools = withReadonlyFallback(
      createQueryTools(readDb),
      createQueryTools(writeDb),
      ({ tool, error }) =>
        console.error(`[ask] readonly tool "${tool}" failed; falling back to admin client:`, error),
    );
    const result = await answerQuestion(getAnthropicClient(), parsed.data.question, tools);
    await logQa(writeDb, { question: parsed.data.question, answerMd: result.answer, toolCalls: result.toolCalls });
    return NextResponse.json(result);
  } catch (err) {
    // Surface the real cause server-side — the client only ever sees the generic message.
    console.error("[ask] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sorry, I couldn't answer that. Please try rephrasing." }, { status: 502 });
  }
}
