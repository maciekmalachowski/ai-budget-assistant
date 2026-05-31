import { createHash } from "node:crypto";

/**
 * Stable fingerprint of a CSV header row, used to recognize a bank's layout
 * and restore its saved import profile. Order-sensitive; case/whitespace-insensitive.
 */
export function headerSignature(header: string[]): string {
  const canonical = header.map((h) => h.trim().toLowerCase()).join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
