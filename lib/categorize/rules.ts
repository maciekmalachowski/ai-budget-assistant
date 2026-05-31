import type { MerchantRule } from "@/lib/domain/types";

/**
 * Return the categoryId of the first matching rule, or null if none match.
 * Matching is case-insensitive. Throws if a regex rule has an invalid pattern.
 */
export function categorizeByRules(
  rawDescription: string,
  merchant: string,
  rules: MerchantRule[],
): string | null {
  const descUpper = rawDescription.toUpperCase();
  const merchantUpper = merchant.toUpperCase();
  const haystack = `${merchantUpper} ${descUpper}`;

  for (const rule of rules) {
    if (rule.matchType === "exact") {
      const p = rule.pattern.toUpperCase();
      if (descUpper === p || merchantUpper === p) return rule.categoryId;
    } else if (rule.matchType === "contains") {
      if (haystack.includes(rule.pattern.toUpperCase())) return rule.categoryId;
    } else {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, "i");
      } catch {
        throw new Error(`Invalid regex in categorization rule: "${rule.pattern}"`);
      }
      if (re.test(rawDescription) || re.test(merchant)) return rule.categoryId;
    }
  }
  return null;
}
