"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

/** The register assigns the code; nobody types one. The RPC locks the
 * sub-group, refuses duplicate names and known old spellings, and issues
 * the next number past the highest ever used. */
export async function addSupplier(params: {
  subgroupId: string;
  name: string;
  notes?: string;
}): Promise<ActionResult<{ supplier_id: string; full_code: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_supplier", {
    p_subgroup_id: params.subgroupId,
    p_name: params.name,
    p_notes: params.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/suppliers");
  return { ok: true, data: data as { supplier_id: string; full_code: string } };
}

/** Rename, annotate, retire or reactivate. The code never changes. */
export async function updateSupplier(params: {
  supplierId: string;
  name: string;
  notes: string | null;
  status: "active" | "retired";
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_supplier", {
    p_supplier_id: params.supplierId,
    p_name: params.name,
    p_notes: params.notes,
    p_status: params.status,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/suppliers");
  return { ok: true, data: undefined };
}

/** Teach the register another old spelling, so searches for it land on the
 * right supplier and code. */
export async function addSupplierAlias(
  supplierId: string,
  alias: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_supplier_alias", {
    p_supplier_id: supplierId,
    p_alias: alias,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/suppliers");
  return { ok: true, data: undefined };
}

/** A new sub-group claims the next free aligned block of ten or a hundred. */
export async function addSupplierSubgroup(params: {
  groupCode: number;
  name: string;
  width: 10 | 100;
}): Promise<ActionResult<{ code_start: number; code_end: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_supplier_subgroup", {
    p_group_code: params.groupCode,
    p_name: params.name,
    p_width: params.width,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/suppliers");
  return { ok: true, data: data as { code_start: number; code_end: number } };
}
