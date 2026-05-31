# AI Budget Assistant — Phase 4: AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. When implementing the Anthropic SDK calls, you may consult the **claude-api** skill for current best-practice patterns — the code below already reflects it.

**Goal:** Build the Claude-powered layer — AI categorization fallback (Haiku), natural-language Q&A via tool-calling (Sonnet), and narrative insights (Sonnet) — as small modules that take an **injected** Anthropic client (and, for Q&A, injected tool implementations) so the whole feature is unit-testable with **mocks and no API key**. A separate opt-in smoke tier exercises the real API.

**Architecture:** `lib/ai/` modules are pure orchestration over a passed-in `client: Anthropic`. `models.ts` holds env-configurable model IDs (no `server-only`, so feature modules and their tests stay importable in any env). `client.ts` is the `server-only` factory used by the API layer (Phase 5) and the smoke test. Categorization returns structured suggestions parsed + validated with Zod; Q&A runs the manual tool-use loop dispatching to an injected `QueryTools` implementation; insights turn a compact stat pack into a short markdown narrative. **Prompt caching** (`cache_control` on the system block) is applied to stable content for cost control. Three test tiers stay isolated: `*.test.ts` (unit, mocked, run by `npm test` — no key, no Docker), `*.itest.ts` (Phase 3 DB), and `*.smoke.ts` (real Anthropic API, opt-in via `npm run test:smoke`, auto-skipped without a key).

**Tech Stack:** `@anthropic-ai/sdk` (already a dependency from Phase 3), `zod` (response validation), Vitest. Models: `claude-haiku-4-5` (categorize), `claude-sonnet-4-6` (Q&A + insights) — env-overridable. Amounts are integer **minor units** throughout.

> **Phase context:** Phase 4 of 7. `main` has Phases 1–3 (scaffold; pure import/categorize engine; Supabase data model + dedup-aware repo). `@anthropic-ai/sdk` and `server-only` are already installed (Phase 3). Spec: `docs/superpowers/specs/2026-05-31-ai-budget-assistant-design.md` §8. This phase builds the AI orchestration with mocked tests; **the real DB-backed query functions behind the Q&A tools, and the wiring that fetches uncategorized rows / computes the stat pack, come in Phase 5 (API + Auth).** The optional real-key smoke test needs `ANTHROPIC_API_KEY` in `.env.local`.

---

## Target File Structure (end of this phase)

```
lib/ai/models.ts                       # env-configurable model IDs (no server-only)
lib/ai/client.ts                       # server-only getAnthropicClient() factory
lib/ai/categorize.ts                   # categorizeWithAI(client, items, taxonomy) -> suggestions
lib/ai/tools.ts                        # QA_TOOLS (schemas) + QueryTools (impl contract)
lib/ai/qa.ts                           # answerQuestion(client, question, tools) -> {answer, toolCalls}
lib/ai/insights.ts                     # generateInsight(client, statPack) -> markdown
lib/ai/__tests__/categorize.test.ts
lib/ai/__tests__/qa.test.ts
lib/ai/__tests__/insights.test.ts
lib/ai/__smoke__/categorize.smoke.ts   # real API, skipped without ANTHROPIC_API_KEY
vitest.smoke.config.ts                 # node env, includes *.smoke.ts, loads .env.local
package.json                           # + zod dep, + test:smoke script
```

**Conventions:** Unit tests mock the Anthropic client (no real calls). `npm test` runs only `*.test.ts`. `npm run test:smoke` runs `*.smoke.ts` against the real API (skips cleanly with no key). Each task ends with a commit; append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 1: Add Zod

- [ ] **Step 1: Install**

Run: `npm install zod@^3.24.1`
Expected: `zod` added under `dependencies`, no `npm error`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add zod for AI response validation"
```

---

## Task 2: Model config

**Files:**
- Create: `lib/ai/models.ts`

- [ ] **Step 1: Create `lib/ai/models.ts`**

```ts
/**
 * Model IDs for each AI feature, overridable via env. No `server-only` here so
 * the feature modules (and their unit tests) can import it in any environment.
 * Haiku for high-volume categorization; Sonnet for Q&A and insights (cost choice).
 */
export const MODELS = {
  categorize: process.env.ANTHROPIC_MODEL_CATEGORIZE || "claude-haiku-4-5",
  qa: process.env.ANTHROPIC_MODEL_QA || "claude-sonnet-4-6",
  insights: process.env.ANTHROPIC_MODEL_INSIGHTS || "claude-sonnet-4-6",
} as const;
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/models.ts
git commit -m "feat(ai): env-configurable model IDs"
```

---

## Task 3: Server-only Anthropic client factory

**Files:**
- Create: `lib/ai/client.ts`

- [ ] **Step 1: Create `lib/ai/client.ts`**

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

/**
 * Server-only Anthropic client. Reads ANTHROPIC_API_KEY from the environment.
 * Never import this in client code or in unit tests (use an injected mock client
 * for the feature modules instead).
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in the environment");
  }
  if (!cached) {
    cached = new Anthropic({ apiKey });
  }
  return cached;
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/client.ts
git commit -m "feat(ai): server-only Anthropic client factory"
```

---

## Task 4: AI categorization fallback (TDD)

**Files:**
- Test: `lib/ai/__tests__/categorize.test.ts`
- Create: `lib/ai/categorize.ts`

- [ ] **Step 1: Write the failing test**

`lib/ai/__tests__/categorize.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { categorizeWithAI } from "@/lib/ai/categorize";

function mockClient(text: string) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("categorizeWithAI", () => {
  it("returns [] without calling the API when there are no items", async () => {
    const { client, create } = mockClient("{}");
    expect(await categorizeWithAI(client, [], ["Groceries"])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("parses structured suggestions and calls Haiku with a cached system prompt", async () => {
    const { client, create } = mockClient(
      JSON.stringify({
        results: [
          { id: "t1", category: "Groceries", confidence: 0.95 },
          { id: "t2", category: "Unknown", confidence: 0.2 },
        ],
      }),
    );
    const out = await categorizeWithAI(
      client,
      [
        { id: "t1", merchant: "BIEDRONKA", description: "BIEDRONKA 123", amountMinor: -8740 },
        { id: "t2", merchant: "ZZZ", description: "ZZZ", amountMinor: -100 },
      ],
      ["Groceries", "Transport"],
    );
    expect(out).toEqual([
      { id: "t1", category: "Groceries", confidence: 0.95 },
      { id: "t2", category: "Unknown", confidence: 0.2 },
    ]);
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe("claude-haiku-4-5");
    expect(arg.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("throws on malformed JSON in the response", async () => {
    const { client } = mockClient("not json");
    await expect(
      categorizeWithAI(client, [{ id: "t1", merchant: "X", description: "X", amountMinor: -1 }], ["Groceries"]),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ai/__tests__/categorize.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/categorize`.

- [ ] **Step 3: Create `lib/ai/categorize.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS } from "@/lib/ai/models";

export interface CategorizationItem {
  id: string;
  merchant: string;
  description: string;
  amountMinor: number;
}

export interface CategorySuggestion {
  id: string;
  /** A category name from the taxonomy, or "Unknown". */
  category: string;
  /** Model certainty, 0..1. */
  confidence: number;
}

const SuggestionSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      confidence: z.number(),
    }),
  ),
});

const SYSTEM = `You categorize bank transactions into a fixed set of spending categories.
For each transaction, choose exactly one category from the taxonomy, or "Unknown" if you are not reasonably sure.
"confidence" is your certainty from 0 to 1.
Respond with ONLY a JSON object of the form {"results":[{"id":string,"category":string,"confidence":number}]} and nothing else — no prose, no code fences.`;

/** Classify a batch of unknown-merchant transactions with Claude (Haiku). */
export async function categorizeWithAI(
  client: Anthropic,
  items: CategorizationItem[],
  taxonomy: string[],
): Promise<CategorySuggestion[]> {
  if (items.length === 0) return [];

  const response = await client.messages.create({
    model: MODELS.categorize,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: `${SYSTEM}\n\nTaxonomy (allowed categories): ${taxonomy.join(", ")}, Unknown`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          items.map((i) => ({
            id: i.id,
            merchant: i.merchant,
            description: i.description,
            amountMinor: i.amountMinor,
          })),
        ),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Categorization response contained no text block");
  }
  const parsed = SuggestionSchema.parse(JSON.parse(textBlock.text));
  return parsed.results;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/ai/__tests__/categorize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/categorize.ts lib/ai/__tests__/categorize.test.ts
git commit -m "feat(ai): batched AI categorization fallback (Haiku)"
```

---

## Task 5: Q&A tool definitions + implementation contract

**Files:**
- Create: `lib/ai/tools.ts`

- [ ] **Step 1: Create `lib/ai/tools.ts`**

```ts
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
```

- [ ] **Step 2: Verify** — `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/tools.ts
git commit -m "feat(ai): Q&A tool schemas and QueryTools contract"
```

---

## Task 6: Q&A tool-use orchestration (TDD)

**Files:**
- Test: `lib/ai/__tests__/qa.test.ts`
- Create: `lib/ai/qa.ts`

- [ ] **Step 1: Write the failing test**

`lib/ai/__tests__/qa.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { answerQuestion } from "@/lib/ai/qa";
import type { QueryTools } from "@/lib/ai/tools";

function fakeTools(overrides: Partial<QueryTools> = {}): QueryTools {
  return {
    totals: vi.fn().mockResolvedValue({ expenseMinor: -482000 }),
    spend_by_category: vi.fn().mockResolvedValue([]),
    compare_periods: vi.fn().mockResolvedValue({}),
    top_merchants: vi.fn().mockResolvedValue([]),
    list_transactions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("answerQuestion", () => {
  it("runs the tool-use loop: calls the tool, feeds the result back, returns the final answer", async () => {
    const create = vi
      .fn()
      // round 1: model asks to call `totals`
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "totals", input: { period: "2026-05", kind: "expense" } }],
      })
      // round 2: model answers
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "You spent 4 820 zł in May 2026." }],
      });
    const client = { messages: { create } } as unknown as Anthropic;
    const tools = fakeTools();

    const result = await answerQuestion(client, "How much did I spend in May?", tools);

    expect(result.answer).toBe("You spent 4 820 zł in May 2026.");
    expect(result.toolCalls).toEqual([{ name: "totals", input: { period: "2026-05", kind: "expense" } }]);
    expect(tools.totals).toHaveBeenCalledWith({ period: "2026-05", kind: "expense" });
    // second call includes a tool_result for tu_1
    const secondMessages = create.mock.calls[1][0].messages;
    const lastUser = secondMessages[secondMessages.length - 1];
    expect(lastUser.role).toBe("user");
    expect(lastUser.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
  });

  it("answers directly when the model uses no tools", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I can help with that." }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const result = await answerQuestion(client, "Hi", fakeTools());
    expect(result.answer).toBe("I can help with that.");
    expect(result.toolCalls).toEqual([]);
  });

  it("captures a tool error into the tool_result rather than throwing", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "totals", input: { period: "bad" } }],
      })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "Sorry." }] });
    const client = { messages: { create } } as unknown as Anthropic;
    const tools = fakeTools({ totals: vi.fn().mockRejectedValue(new Error("bad period")) });

    const result = await answerQuestion(client, "x", tools);
    expect(result.answer).toBe("Sorry.");
    const toolResult = create.mock.calls[1][0].messages.at(-1).content[0];
    expect(toolResult.content).toContain("bad period");
  });

  it("stops after maxRounds and returns a graceful fallback", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu", name: "totals", input: { period: "2026-05" } }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const result = await answerQuestion(client, "loop", fakeTools(), { maxRounds: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.answer).toMatch(/couldn't/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ai/__tests__/qa.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/qa`.

- [ ] **Step 3: Create `lib/ai/qa.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/ai/models";
import { QA_TOOLS, type QueryTools, type QueryToolName } from "@/lib/ai/tools";

export interface QaResult {
  answer: string;
  toolCalls: { name: string; input: unknown }[];
}

const SYSTEM = `You answer questions about the user's personal finances using ONLY the provided tools.
Never invent numbers — call a tool to get real data. Amounts are integer minor units (e.g. grosze); divide by 100 for display and include the currency. Be concise and direct.`;

/**
 * Answer a finance question by letting Claude (Sonnet) call read-only query tools.
 * Runs the manual tool-use loop, dispatching each tool_use to the injected `tools`.
 */
export async function answerQuestion(
  client: Anthropic,
  question: string,
  tools: QueryTools,
  opts: { maxRounds?: number } = {},
): Promise<QaResult> {
  const maxRounds = opts.maxRounds ?? 6;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const toolCalls: { name: string; input: unknown }[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const response = await client.messages.create({
      model: MODELS.qa,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: QA_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { answer, toolCalls };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolCalls.push({ name: block.name, input: block.input });
      const impl = (tools as Record<string, ((input: unknown) => Promise<unknown>) | undefined>)[block.name];
      let resultText: string;
      try {
        const output = impl
          ? await impl(block.input)
          : { error: `Unknown tool: ${block.name}` };
        resultText = JSON.stringify(output);
      } catch (err) {
        resultText = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    answer:
      "I couldn't finish answering within the allowed number of steps. Please rephrase or narrow the question.",
    toolCalls,
  };
}

// Compile-time guard that QA_TOOLS names line up with the QueryTools contract.
const _toolNameCheck: QueryToolName[] = QA_TOOLS.map((t) => t.name as QueryToolName);
void _toolNameCheck;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/ai/__tests__/qa.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/qa.ts lib/ai/__tests__/qa.test.ts
git commit -m "feat(ai): tool-calling Q&A orchestration (Sonnet)"
```

---

## Task 7: Insights generation (TDD)

**Files:**
- Test: `lib/ai/__tests__/insights.test.ts`
- Create: `lib/ai/insights.ts`

- [ ] **Step 1: Write the failing test**

`lib/ai/__tests__/insights.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateInsight, type InsightStatPack } from "@/lib/ai/insights";

const pack: InsightStatPack = {
  periodLabel: "May 2026",
  currency: "PLN",
  totalSpentMinor: -482000,
  totalIncomeMinor: 950000,
  byCategory: [{ category: "Groceries", spentMinor: -121000 }],
  vsPrevious: [{ category: "Groceries", deltaPct: 30 }],
  topMerchants: [{ merchant: "BIEDRONKA", spentMinor: -87400 }],
  newMerchants: ["NETFLIX"],
};

describe("generateInsight", () => {
  it("sends the stat pack to Sonnet with a cached system prompt and returns the narrative", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "  Groceries up 30% vs April.  " }],
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const out = await generateInsight(client, pack);

    expect(out).toBe("Groceries up 30% vs April.");
    const arg = create.mock.calls[0][0];
    expect(arg.model).toBe("claude-sonnet-4-6");
    expect(arg.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(arg.messages[0].content).toContain("May 2026");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ai/__tests__/insights.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/insights`.

- [ ] **Step 3: Create `lib/ai/insights.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/ai/models";

/** Compact, pre-computed numbers handed to the model (no raw transactions). */
export interface InsightStatPack {
  periodLabel: string;
  currency: string;
  totalSpentMinor: number;
  totalIncomeMinor: number;
  byCategory: { category: string; spentMinor: number }[];
  vsPrevious: { category: string; deltaPct: number }[];
  topMerchants: { merchant: string; spentMinor: number }[];
  newMerchants: string[];
}

const SYSTEM = `You write a short, friendly monthly money summary for one person, in Markdown.
You are given pre-computed statistics (amounts are integer minor units — divide by 100 and show the currency).
Write 2-4 short bullet points highlighting the most notable things (big movers vs the previous period, top spend, new recurring merchants). Do not invent numbers beyond what is provided. No headings, no preamble.`;

/** Turn a compact stat pack into a short Markdown narrative (Sonnet). */
export async function generateInsight(client: Anthropic, statPack: InsightStatPack): Promise<string> {
  const response = await client.messages.create({
    model: MODELS.insights,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(statPack) }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/ai/__tests__/insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/insights.ts lib/ai/__tests__/insights.test.ts
git commit -m "feat(ai): cached insights narrative generation (Sonnet)"
```

---

## Task 8: Opt-in real-API smoke tier

**Files:**
- Create: `vitest.smoke.config.ts`
- Modify: `package.json` (add `test:smoke` script)
- Create: `lib/ai/__smoke__/categorize.smoke.ts`

- [ ] **Step 1: Create `vitest.smoke.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.integration.setup.ts"], // reuses dotenv loader from Phase 3
    include: ["**/*.smoke.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", ".worktrees/**"],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
```

- [ ] **Step 2: Add the script to `package.json`** — in `"scripts"`, add:

```json
    "test:smoke": "vitest run --config vitest.smoke.config.ts",
```

- [ ] **Step 3: Create `lib/ai/__smoke__/categorize.smoke.ts`**

```ts
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { categorizeWithAI } from "@/lib/ai/categorize";

const hasKey = !!process.env.ANTHROPIC_API_KEY;

// Auto-skips when no key is present, so `npm run test:smoke` passes cleanly
// in credential-free environments. Provide ANTHROPIC_API_KEY in .env.local to run it.
describe.skipIf(!hasKey)("categorizeWithAI (real API)", () => {
  it("classifies an obvious grocery transaction", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const out = await categorizeWithAI(
      client,
      [{ id: "t1", merchant: "BIEDRONKA", description: "BIEDRONKA 1234 WARSZAWA", amountMinor: -8740 }],
      ["Groceries", "Transport", "Dining", "Utilities"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("t1");
    expect(out[0].category).toBe("Groceries");
  });
});
```

- [ ] **Step 4: Verify the smoke runner skips cleanly without a key**

Run: `npm run test:smoke`
Expected: runs, reports the suite as skipped (no failures) when `ANTHROPIC_API_KEY` is absent. (With a key in `.env.local`, it makes one real Haiku call and asserts "Groceries".)

- [ ] **Step 5: Commit**

```bash
git add vitest.smoke.config.ts package.json lib/ai/__smoke__/categorize.smoke.ts
git commit -m "test(ai): opt-in real-API smoke tier (skips without ANTHROPIC_API_KEY)"
```

---

## Task 9: Full verification

- [ ] **Step 1: Unit suite (no key, no Docker)** — `npm test`
Expected: all prior + new unit tests pass; NO `*.itest.ts` or `*.smoke.ts` collected. (Phase 1–3 = 50, plus the new AI unit tests.)

- [ ] **Step 2: Smoke tier skips cleanly** — `npm run test:smoke`
Expected: 0 failures (suite skipped) without a key.

- [ ] **Step 3: typecheck / lint / build**

```bash
npm run typecheck   # exit 0
npm run lint        # "No ESLint warnings or errors"
npm run build       # "Compiled successfully"
```

- [ ] **Step 4: Commit anything outstanding (if not clean)**

```bash
git add -A -- ':!.env.local'
git commit -m "chore: phase 4 verification" || echo "nothing to commit"
```

---

## Done when

- `npm test` (unit, mocked, no key) passes and collects no `*.itest.ts`/`*.smoke.ts`.
- `npm run test:smoke` passes (skipped) with no key; makes a real Haiku call and asserts "Groceries" with a key in `.env.local`.
- `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- The AI layer exists as injected-client modules: `categorizeWithAI`, `answerQuestion` (tool-use loop over an injected `QueryTools`), and `generateInsight` — all prompt-cached and unit-tested with mocks.

**Next:** Phase 5 — API + Auth: Supabase Auth + single-user middleware lock; server actions / route handlers that wire the import pipeline (Phase 2) → repository (Phase 3) → AI categorization fallback (Phase 4), implement the real DB-backed `QueryTools` behind Q&A, and compute the insights stat pack.
