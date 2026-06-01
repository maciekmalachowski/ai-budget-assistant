"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCorrection } from "@/lib/transactions/correct";

export interface CorrectResult {
  ok: boolean;
  error?: string;
}

/** Server Action: apply a category correction from the transactions table, then revalidate the affected pages. */
export async function correctCategory(input: {
  transactionId: string;
  merchant: string | null;
  categoryName: string;
}): Promise<CorrectResult> {
  try {
    await applyCorrection(createAdminClient(), input);
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Correction failed" };
  }
}
