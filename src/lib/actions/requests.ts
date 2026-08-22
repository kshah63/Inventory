"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, CatalogueMatch, RequestStatus } from "@/lib/types";

/** What someone is typing, matched against the catalogue: names, item codes
 * and the aliases procurement has taught it. Nothing here blocks a request —
 * it only offers what we already have. */
export async function searchCatalogue(query: string): Promise<CatalogueMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_catalogue", {
    p_query: q,
    p_limit: 3,
  });
  if (error) {
    console.error("search_catalogue failed —", error.message);
    return [];
  }
  return (data ?? []) as CatalogueMatch[];
}

/** Request an item that isn't in the catalogue. RLS enforces
 * requested_by = self. */
export async function createRequest(params: {
  itemName: string;
  description?: string;
  productUrl?: string;
  photoUrl?: string;
  qty: number;
  zone?: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const itemName = params.itemName.trim();
  if (!itemName) return { ok: false, error: "Tell us what you need." };
  if (!params.qty || params.qty <= 0) {
    return { ok: false, error: "Quantity must be at least 1." };
  }

  const url = params.productUrl?.trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, error: "The product link should start with http:// or https://" };
  }

  const { error } = await supabase.from("requests").insert({
    requested_by: user.id,
    item_id: null,
    free_text_item: itemName,
    description: params.description?.trim() || null,
    product_url: url || null,
    photo_url: params.photoUrl || null,
    qty: params.qty,
    zone: params.zone?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/requests");
  return { ok: true, data: undefined };
}

/** Upload a photo of a requested item and return its public URL. Called
 * before the request row is created. */
export async function uploadRequestPhoto(
  formData: FormData
): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No photo selected." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Photo must be under 5MB." };
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "That file isn't an image." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${user.id}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("request-photos")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) return { ok: false, error: error.message };

  const {
    data: { publicUrl },
  } = supabase.storage.from("request-photos").getPublicUrl(path);
  return { ok: true, data: { url: publicUrl } };
}

/** Procurement recognises a request as something already on the shelf: it
 * becomes a real order for the person who asked, and the request closes.
 * Optionally teaches the matcher the words they used. */
export async function fulfilRequestFromStock(params: {
  requestId: string;
  itemId: string;
  qty: number;
  note?: string;
  rememberAlias?: string;
}): Promise<ActionResult<{ order_no: number; item_name: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fulfil_request_from_stock", {
    p_request_id: params.requestId,
    p_item_id: params.itemId,
    p_qty: params.qty,
    p_note: params.note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const info = data as {
    order_no: number;
    item_name: string;
    qty: number;
    requested_text: string;
  };

  // The words that person used now find this item for everyone else.
  const alias = params.rememberAlias?.trim();
  if (alias) {
    const { error: aliasError } = await supabase.rpc("add_item_alias", {
      p_item_id: params.itemId,
      p_alias: alias,
    });
    if (aliasError) console.error("add_item_alias failed —", aliasError.message);
  }

  revalidatePath("/admin/requests");
  revalidatePath("/orders");
  return { ok: true, data: { order_no: info.order_no, item_name: info.item_name } };
}

/** Correct the quantity on a request that hasn't been ordered yet. */
export async function updateRequestQty(
  requestId: string,
  qty: number
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_request_qty", {
    p_request_id: requestId,
    p_qty: qty,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders");
  revalidatePath("/admin/requests");
  return { ok: true, data: undefined };
}

export async function cancelOwnRequest(requestId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", requestId)
    .eq("status", "open");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/requests");
  return { ok: true, data: undefined };
}

/** Procurement moves a request along and sets the date the requester sees.
 * Their portal only shows the stages that mean something to them — stock
 * arriving in the store room is our business; being ready to collect is
 * theirs. */
export async function setRequestProgress(params: {
  requestId: string;
  status?: RequestStatus;
  expectedDate?: string | null;
  adminNote?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_request_progress", {
    p_request_id: params.requestId,
    p_status: params.status ?? null,
    p_expected_date: params.expectedDate || null,
    p_clear_expected: params.expectedDate === null,
    p_admin_note: params.adminNote?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/requests");
  revalidatePath("/orders");
  return { ok: true, data: undefined };
}

/** Procurement moves a request through its statuses. The requester sees the
 * change next time they open their requests. */
export async function updateRequestStatus(
  requestId: string,
  status: RequestStatus,
  adminNote?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ status, admin_note: adminNote?.trim() || null })
    .eq("id", requestId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/requests");
  return { ok: true, data: undefined };
}

/** Approve or reject an approval-required checkout. On approval the stock
 * transaction is recorded. */
export async function decidePendingCheckout(
  pendingId: string,
  approve: boolean,
  note?: string
): Promise<ActionResult<{ status: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_pending_checkout", {
    p_id: pendingId,
    p_approve: approve,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const info = data as {
    status: string;
    item_name: string;
    unit: string;
    qty: number;
    location_name: string;
  };

  revalidatePath("/admin/approvals");
  return { ok: true, data: { status: info.status } };
}
