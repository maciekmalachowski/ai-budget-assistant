import { describe, it, expect } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCategories, getTaxonomy, getCategoryNameToId } from "@/lib/repos/categories";

const db = createAdminClient();

describe.sequential("categories repository (integration)", () => {
  it("lists the seeded categories with their kinds", async () => {
    const cats = await listCategories(db);
    const groceries = cats.find((c) => c.name === "Groceries");
    const income = cats.find((c) => c.name === "Income");
    expect(groceries?.kind).toBe("expense");
    expect(income?.kind).toBe("income");
    expect(cats.length).toBeGreaterThanOrEqual(12);
  });

  it("returns the taxonomy as a name list", async () => {
    const taxonomy = await getTaxonomy(db);
    expect(taxonomy).toContain("Groceries");
    expect(taxonomy).toContain("Transport");
  });

  it("maps names to ids", async () => {
    const map = await getCategoryNameToId(db);
    const id = map.get("Groceries");
    expect(typeof id).toBe("string");
    expect(id?.length).toBeGreaterThan(0);
  });
});
