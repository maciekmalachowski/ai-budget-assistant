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
