/**
 * Curated Polish-merchant → category dictionary, applied as case-insensitive `contains`
 * rules over the reconstructed description (so noisy lines like "JMP S.A. BIEDRONKA 4014"
 * still match on the brand keyword). Single source of truth; loaded into merchant_map by
 * seedMerchantRules(). Patterns chosen to avoid cross-category substring collisions.
 *
 * Known gap (intentionally absent): online-payment gateways (PayU, PayPro, tpay, Paynow,
 * Cashbill, IdoPay) mask the real merchant — left for the user to correct, then remembered.
 */
export interface SeedRule {
  pattern: string;
  matchType: "contains" | "exact";
  categoryName: string;
}

export const SEED_RULES: SeedRule[] = [
  // Groceries
  { pattern: "LIDL", matchType: "contains", categoryName: "Groceries" },
  { pattern: "BIEDRONKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "ALDI", matchType: "contains", categoryName: "Groceries" },
  { pattern: "ZABKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "ŻABKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "LECLERC", matchType: "contains", categoryName: "Groceries" },
  { pattern: "CARREFOUR", matchType: "contains", categoryName: "Groceries" },
  { pattern: "KAUFLAND", matchType: "contains", categoryName: "Groceries" },
  { pattern: "AUCHAN", matchType: "contains", categoryName: "Groceries" },
  { pattern: "TOP MARKET", matchType: "contains", categoryName: "Groceries" },
  { pattern: "DELIKATESY", matchType: "contains", categoryName: "Groceries" },
  { pattern: "NETTO", matchType: "contains", categoryName: "Groceries" },
  { pattern: "STOKROTKA", matchType: "contains", categoryName: "Groceries" },
  { pattern: "DINO", matchType: "contains", categoryName: "Groceries" },
  // Dining (put EATS before any generic UBER rule; we don't add a bare UBER rule)
  { pattern: "UBER * EATS", matchType: "contains", categoryName: "Dining" },
  { pattern: "MCDONALD", matchType: "contains", categoryName: "Dining" },
  { pattern: "KEBAB", matchType: "contains", categoryName: "Dining" },
  { pattern: "SUSHI", matchType: "contains", categoryName: "Dining" },
  { pattern: "BAR MLECZNY", matchType: "contains", categoryName: "Dining" },
  { pattern: "PIZZA", matchType: "contains", categoryName: "Dining" },
  { pattern: "GLOVO", matchType: "contains", categoryName: "Dining" },
  { pattern: "PYSZNE", matchType: "contains", categoryName: "Dining" },
  { pattern: "KFC", matchType: "contains", categoryName: "Dining" },
  { pattern: "STARBUCKS", matchType: "contains", categoryName: "Dining" },
  // Transport
  { pattern: "JAKDOJADE", matchType: "contains", categoryName: "Transport" },
  { pattern: "BKM", matchType: "contains", categoryName: "Transport" },
  { pattern: "BOLT.EU", matchType: "contains", categoryName: "Transport" },
  { pattern: "CITYBIKE", matchType: "contains", categoryName: "Transport" },
  { pattern: "CITY-NAV", matchType: "contains", categoryName: "Transport" },
  { pattern: "INTERCITY", matchType: "contains", categoryName: "Transport" },
  { pattern: "ORLEN", matchType: "contains", categoryName: "Transport" },
  { pattern: "SYSTEMFALA", matchType: "contains", categoryName: "Transport" },
  { pattern: "MPK", matchType: "contains", categoryName: "Transport" },
  // Health
  { pattern: "ZDROFIT", matchType: "contains", categoryName: "Health" },
  { pattern: "FOX MED", matchType: "contains", categoryName: "Health" },
  { pattern: "NZOZ", matchType: "contains", categoryName: "Health" },
  { pattern: "SUPER-PHARM", matchType: "contains", categoryName: "Health" },
  { pattern: "ROSSMANN", matchType: "contains", categoryName: "Health" },
  { pattern: "APTEKA", matchType: "contains", categoryName: "Health" },
  { pattern: "FIZJO", matchType: "contains", categoryName: "Health" },
  { pattern: "BARBERWAVE", matchType: "contains", categoryName: "Health" },
  // Shopping
  { pattern: "IKEA", matchType: "contains", categoryName: "Shopping" },
  { pattern: "JYSK", matchType: "contains", categoryName: "Shopping" },
  { pattern: "LEROY MERLIN", matchType: "contains", categoryName: "Shopping" },
  { pattern: "MEDIA MARKT", matchType: "contains", categoryName: "Shopping" },
  { pattern: "EURO-NET", matchType: "contains", categoryName: "Shopping" },
  { pattern: "TEMU", matchType: "contains", categoryName: "Shopping" },
  { pattern: "DECATHLON", matchType: "contains", categoryName: "Shopping" },
  { pattern: "EMPIK", matchType: "contains", categoryName: "Shopping" },
  { pattern: "EOBUWIE", matchType: "contains", categoryName: "Shopping" },
  { pattern: "AGATA", matchType: "contains", categoryName: "Shopping" },
  { pattern: "ALLEGRO", matchType: "contains", categoryName: "Shopping" },
  // Subscriptions
  { pattern: "NETFLIX", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "SPOTIFY", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "YOUTUBE", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "OPENAI", matchType: "contains", categoryName: "Subscriptions" },
  { pattern: "ANTHROPIC", matchType: "contains", categoryName: "Subscriptions" },
  // Housing (matches the note in the reconstructed description)
  { pattern: "CZYNSZ", matchType: "contains", categoryName: "Housing" },
  { pattern: "KAUCJA", matchType: "contains", categoryName: "Housing" },
  // Income
  { pattern: "UMOWA ZLECENIE", matchType: "contains", categoryName: "Income" },
  { pattern: "WYNAGRODZENIE", matchType: "contains", categoryName: "Income" },
  { pattern: "ODSETKI", matchType: "contains", categoryName: "Income" },
  // Transfer (internal moves)
  { pattern: "BETWEEN YOUR OWN ACCOUNTS", matchType: "contains", categoryName: "Transfer" },
  // Other (bank fees/tax)
  { pattern: "PODATEK", matchType: "contains", categoryName: "Other" },
];
