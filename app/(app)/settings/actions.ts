"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAccount as repoCreateAccount,
  deleteAccount as repoDeleteAccount,
  renameAccount as repoRenameAccount,
} from "@/lib/repos/accounts";
import {
  createCategory as repoCreateCategory,
  deleteCategory as repoDeleteCategory,
  recolorCategory as repoRecolorCategory,
  renameCategory as repoRenameCategory,
  type Category,
} from "@/lib/repos/categories";
import { deleteProfile as repoDeleteProfile } from "@/lib/repos/imports";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : "Something went wrong.";
  if (msg.includes("categories_name_key")) {
    return { ok: false, error: "A category with that name already exists." };
  }
  return { ok: false, error: msg };
}

// --- Accounts ---

export async function createAccountAction(input: { name: string; currency: string }): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoCreateAccount(createAdminClient(), {
      name: input.name.trim(),
      currency: input.currency.trim() || "PLN",
    });
    revalidatePath("/settings");
    revalidatePath("/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameAccountAction(input: { id: string; name: string }): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoRenameAccount(createAdminClient(), input.id, input.name.trim());
    revalidatePath("/settings");
    revalidatePath("/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccountAction(input: { id: string }): Promise<ActionResult> {
  try {
    await repoDeleteAccount(createAdminClient(), input.id);
    revalidatePath("/settings");
    revalidatePath("/import");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- Categories ---

export async function createCategoryAction(input: {
  name: string;
  kind: Category["kind"];
  color: string | null;
}): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoCreateCategory(createAdminClient(), {
      name: input.name.trim(),
      kind: input.kind,
      color: input.color,
    });
    revalidatePath("/settings");
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameCategoryAction(input: { id: string; name: string }): Promise<ActionResult> {
  try {
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    await repoRenameCategory(createAdminClient(), input.id, input.name.trim());
    revalidatePath("/settings");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function recolorCategoryAction(input: { id: string; color: string | null }): Promise<ActionResult> {
  try {
    await repoRecolorCategory(createAdminClient(), input.id, input.color);
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCategoryAction(input: { id: string }): Promise<ActionResult> {
  try {
    await repoDeleteCategory(createAdminClient(), input.id);
    revalidatePath("/settings");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- Import profiles ---

export async function deleteProfileAction(input: { id: string }): Promise<ActionResult> {
  try {
    await repoDeleteProfile(createAdminClient(), input.id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
