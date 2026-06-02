import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReadonlyClient } from "@/lib/supabase/readonly";
import { getAnthropicClient } from "@/lib/ai/client";
import { answerQuestion } from "@/lib/ai/qa";
import { createQueryTools } from "@/lib/queries/tools";
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

  const readDb = createReadonlyClient();
  const writeDb = createAdminClient();
  try {
    const result = await answerQuestion(getAnthropicClient(), parsed.data.question, createQueryTools(readDb));
    await logQa(writeDb, { question: parsed.data.question, answerMd: result.answer, toolCalls: result.toolCalls });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Sorry, I couldn't answer that. Please try rephrasing." }, { status: 502 });
  }
}
