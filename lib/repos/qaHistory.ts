import type { Db } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/** Append a Q&A interaction to the history log; returns the row id. */
export async function logQa(
  db: Db,
  input: { question: string; answerMd: string; toolCalls: unknown },
): Promise<string> {
  const { data, error } = await db
    .from("qa_history")
    .insert({
      question: input.question,
      answer_md: input.answerMd,
      tool_calls: input.toolCalls as Json,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
