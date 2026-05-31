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
