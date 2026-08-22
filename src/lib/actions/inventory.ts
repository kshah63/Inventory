"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export async function receiveStock(
  locationId: string,
  lines: { item_id: string; qty: number }[],
  note?: string
): Promise<ActionResult<number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_stock", {
    p_location_id: locationId,
    p_lines: lines,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true, data: data as number };
}

export async function transferStock(params: {
  itemId: string;
  fromLocation: string;
  toLocation: string;
  qty: number;
  note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_stock", {
    p_item_id: params.itemId,
    p_from_location: params.fromLocation,
    p_to_location: params.toLocation,
    p_qty: params.qty,
    p_note: params.note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true, data: undefined };
}

export async function adjustStock(params: {
  itemId: string;
  locationId: string;
  qtyDelta: number;
  note: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_item_id: params.itemId,
    p_location_id: params.locationId,
    p_qty_delta: params.qtyDelta,
    p_note: params.note,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true, data: undefined };
}

export async function applyStocktake(
  locationId: string,
  lines: { item_id: string; counted_qty: number }[],
  note?: string
): Promise<ActionResult<{ stocktake_id: string; adjustments: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_stocktake", {
    p_location_id: locationId,
    p_lines: lines,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true, data: data as { stocktake_id: string; adjustments: number } };
}

export interface ImportRow {
  sku: string;
  name: string;
  category: string;
  unit?: string;
  pack_size?: string;
  max_per_checkout?: string;
  keep_about?: string;
  notes?: string;
  stock: {
    location: string;
    qty: string | null;
  }[];
}

export async function importCatalog(
  rows: ImportRow[]
): Promise<ActionResult<{ created: number; updated: number; stock_adjusted: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_catalog", { p_rows: rows });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/inventory");
  return {
    ok: true,
    data: data as { created: number; updated: number; stock_adjusted: number },
  };
}

export async function saveItem(params: {
  id?: string;
  sku: string;
  name: string;
  categoryId: string;
  unit: string;
  packSize: number | null;
  notes: string | null;
  maxPerCheckout: number | null;
  keepAbout: number | null;
  adminOnly: boolean;
  isActive: boolean;
  photoUrl?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const row = {
    sku: params.sku.trim(),
    name: params.name.trim(),
    category_id: params.categoryId,
    unit: params.unit.trim() || "pcs",
    pack_size: params.packSize,
    notes: params.notes?.trim() || null,
    max_per_checkout: params.maxPerCheckout,
    keep_about: params.keepAbout,
    admin_only: params.adminOnly,
    is_active: params.isActive,
    ...(params.photoUrl !== undefined ? { photo_url: params.photoUrl } : {}),
  };
  if (!row.sku || !row.name) return { ok: false, error: "SKU and name are required." };

  if (params.id) {
    const { error } = await supabase.from("items").update(row).eq("id", params.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/inventory");
    return { ok: true, data: { id: params.id } };
  }
  const { data, error } = await supabase.from("items").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `SKU "${row.sku}" already exists.` };
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/inventory");
  return { ok: true, data: { id: data.id } };
}

export async function uploadItemPhoto(
  itemId: string,
  formData: FormData
): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No photo selected." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Photo must be under 5MB." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${itemId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("item-photos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { ok: false, error: uploadError.message };

  const {
    data: { publicUrl },
  } = supabase.storage.from("item-photos").getPublicUrl(path);

  const { error } = await supabase
    .from("items")
    .update({ photo_url: publicUrl })
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/inventory");
  return { ok: true, data: { url: publicUrl } };
}

/**
 * Which store rooms an item is actually kept in. A room with no row means
 * we don't keep it there, so it stops showing as a zero on that room's list.
 * The RPC refuses to drop a room that still holds stock.
 */
export async function setItemRooms(
  itemId: string,
  locationIds: string[]
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_item_rooms", {
    p_item_id: itemId,
    p_location_ids: locationIds,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/inventory");
  return { ok: true, data: null };
}

/**
 * Delete an item outright — for the mistake typed in last week, not for
 * something we've stopped stocking. The RPC refuses once anything points at
 * it, and says to remove it from the catalogue instead.
 */
export async function deleteItem(itemId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_item", { p_item_id: itemId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/inventory");
  return { ok: true, data: null };
}

export async function saveCategory(
  name: string
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({ name: name.trim() })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Category already exists." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/inventory");
  return { ok: true, data: { id: data.id } };
}
