import type Anthropic from "@anthropic-ai/sdk";

/**
 * The read-only query functions the Q&A model may call. Phase 5 supplies the
 * real DB-backed implementations; unit tests pass mocks. Each returns a
 * JSON-serializable result (numbers are integer minor units).
 */
export interface QueryTools {
  totals: (input: { period: string; kind?: "expense" | "income"; accountId?: string }) => Promise<unknown>;
  spend_by_category: (input: { period: string; accountId?: string }) => Promise<unknown>;
  compare_periods: (input: { metric: string; periodA: string; periodB: string }) => Promise<unknown>;
  top_merchants: (input: { period: string; limit?: number }) => Promise<unknown>;
  list_transactions: (input: {
    from?: string;
    to?: string;
    category?: string;
    merchant?: string;
    minAmountMinor?: number;
    maxAmountMinor?: number;
    limit?: number;
  }) => Promise<unknown>;
}

export type QueryToolName = keyof QueryTools;

/** Tool schemas presented to Claude. Periods are "YYYY-MM" (month) or "YYYY-MM-DD..YYYY-MM-DD". */
export const QA_TOOLS: Anthropic.Tool[] = [
  {
    name: "totals",
    description: "Sum of income and/or expense over a period. Use for 'how much did I spend/earn'.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Month 'YYYY-MM' or range 'YYYY-MM-DD..YYYY-MM-DD'" },
        kind: { type: "string", enum: ["expense", "income"], description: "Restrict to expense or income" },
        accountId: { type: "string", description: "Optional account UUID" },
      },
      required: ["period"],
    },
  },
  {
    name: "spend_by_category",
    description: "Spending broken down by category for a period. Use for 'where did my money go'.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string" },
        accountId: { type: "string" },
      },
      required: ["period"],
    },
  },
  {
    name: "compare_periods",
    description: "Compare a metric between two periods. Use for 'X this month vs last month'.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", description: "e.g. 'total_expense' or a category name" },
        periodA: { type: "string" },
        periodB: { type: "string" },
      },
      required: ["metric", "periodA", "periodB"],
    },
  },
  {
    name: "top_merchants",
    description: "Highest-spend merchants over a period.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string" },
        limit: { type: "integer", description: "Max merchants to return (default 5)" },
      },
      required: ["period"],
    },
  },
  {
    name: "list_transactions",
    description: "List individual transactions matching filters. Use for 'show me transactions where...'.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date inclusive" },
        to: { type: "string", description: "ISO date inclusive" },
        category: { type: "string" },
        merchant: { type: "string" },
        minAmountMinor: { type: "integer" },
        maxAmountMinor: { type: "integer" },
        limit: { type: "integer", description: "Max rows (default 50)" },
      },
      required: [],
    },
  },
];
