import { afterEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCategory,
  deleteCategory,
  getCategoryNameToId,
  getTaxonomy,
  listCategories,
  listCategoriesWithCounts,
  recolorCategory,
  renameCategory,
} from "@/lib/repos/categories";

const db = createAdminClient();
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.from("categories").delete().eq("id", id);
  }
});

// --- Original coverage (Phase 3): seeded taxonomy reads ---

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

// --- Phase 6C: CRUD with counts + system guard ---

describe("categories repo (integration)", () => {
  it("creates, lists with count + isSystem, renames, recolors", async () => {
    const id = await createCategory(db, { name: "ZZ Test Cat", kind: "expense", color: "#123456" });
    created.push(id);

    const list = await listCategoriesWithCounts(db);
    const row = list.find((c) => c.id === id);
    expect(row).toBeTruthy();
    expect(row!.isSystem).toBe(false);
    expect(row!.transactionCount).toBe(0);

    await renameCategory(db, id, "ZZ Renamed Cat");
    await recolorCategory(db, id, "#abcdef");
    const after = await listCategoriesWithCounts(db);
    const updated = after.find((c) => c.id === id)!;
    expect(updated.name).toBe("ZZ Renamed Cat");
    expect(updated.color).toBe("#abcdef");
  });

  it("rejects a duplicate name", async () => {
    const id = await createCategory(db, { name: "ZZ Dupe", kind: "expense" });
    created.push(id);
    await expect(createCategory(db, { name: "ZZ Dupe", kind: "expense" })).rejects.toThrow();
  });

  it("refuses to delete a system category", async () => {
    const list = await listCategoriesWithCounts(db);
    const sys = list.find((c) => c.isSystem);
    expect(sys).toBeTruthy();
    await expect(deleteCategory(db, sys!.id)).rejects.toThrow(/system/i);
  });

  it("deletes a user category", async () => {
    const id = await createCategory(db, { name: "ZZ Deleteme", kind: "expense" });
    await expect(deleteCategory(db, id)).resolves.toBeUndefined();
    // not pushed to `created` — already gone
  });
});
