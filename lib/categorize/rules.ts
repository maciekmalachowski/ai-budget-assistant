import type { MerchantRule } from "@/lib/domain/types";

/** Optional knobs for categorizeByRules. */
export interface CategorizeOptions {
  /**
   * Restrict the `contains` and `regex` (brand-keyword) scans to this text instead of
   * `merchant + rawDescription`. Used for person-to-person transfers, where the merchant IS a
   * payee name and the raw line embeds it, so brand keywords (AGATA, APTEKA, DINO…) would
   * otherwise collide. Pass the note/title here (it never contains the counterparty name), or
   * "" to disable brand matching entirely. The `exact` branch is unaffected, so user/AI exact
   * corrections on a payee name still apply.
   */
  containsText?: string;
}

/**
 * Return the categoryId of the first matching rule, or null if none match.
 * Matching is case-insensitive. Throws if a regex rule has an invalid pattern.
 */
export function categorizeByRules(
  rawDescription: string,
  merchant: string,
  rules: MerchantRule[],
  opts?: CategorizeOptions,
): string | null {
  const descUpper = rawDescription.toUpperCase();
  const merchantUpper = merchant.toUpperCase();
  // For `contains`/`regex`, scope to opts.containsText when provided; otherwise the full line.
  const scoped = opts?.containsText !== undefined;
  const containsHaystack = scoped ? opts.containsText!.toUpperCase() : `${merchantUpper} ${descUpper}`;

  for (const rule of rules) {
    if (rule.matchType === "exact") {
      const p = rule.pattern.toUpperCase();
      if (descUpper === p || merchantUpper === p) return rule.categoryId;
    } else if (rule.matchType === "contains") {
      if (containsHaystack.includes(rule.pattern.toUpperCase())) return rule.categoryId;
    } else {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, "i");
      } catch {
        throw new Error(`Invalid regex in categorization rule: "${rule.pattern}"`);
      }
      const matched = scoped ? re.test(opts.containsText!) : re.test(rawDescription) || re.test(merchant);
      if (matched) return rule.categoryId;
    }
  }
  return null;
}
