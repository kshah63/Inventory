"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  composeApprovalDecisionMessage,
  composeRequestUpdateMessage,
  sendWhatsApp,
} from "@/lib/whatsapp";
import type { ActionResult, RequestStatus } from "@/lib/types";

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

/** Procurement moves a request through its statuses; notifies the requester
 * on WhatsApp if their number is on file. */
export async function updateRequestStatus(
  requestId: string,
  status: RequestStatus,
  adminNote?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("requests")
    .update({ status, admin_note: adminNote?.trim() || null })
    .eq("id", requestId)
    .select("id, qty, status, admin_note, requested_by, item_id, free_text_item, items(name)")
    .single();
  if (error) return { ok: false, error: error.message };

  // Notify the requester on WhatsApp if their number is on file.
  try {
    const row = updated as unknown as {
      qty: number;
      status: string;
      admin_note: string | null;
      requested_by: string;
      free_text_item: string | null;
      items: { name: string } | null;
    };
    const admin = createAdminClient();
    const { data: requester } = await admin
      .from("users")
      .select("phone")
      .eq("id", row.requested_by)
      .single();
    if (requester?.phone) {
      await sendWhatsApp(
        requester.phone,
        composeRequestUpdateMessage({
          item_label: row.items?.name ?? row.free_text_item ?? "item",
          qty: row.qty,
          status: row.status,
          admin_note: row.admin_note,
        }),
        "request_update"
      );
    }
  } catch {
    // Notification failures never block the status change.
  }

  revalidatePath("/admin/requests");
  return { ok: true, data: undefined };
}

/** Approve or reject an approval-required checkout. On approval the stock
 * transaction is recorded; the requester is notified either way. */
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
    requester_phone: string | null;
    location_name: string;
  };

  if (info.requester_phone) {
    await sendWhatsApp(
      info.requester_phone,
      composeApprovalDecisionMessage({
        status: info.status,
        qty: info.qty,
        item_name: info.item_name,
        location_name: info.location_name,
        decision_note: note,
      }),
      "approval_decided"
    ).catch(() => {});
  }

  revalidatePath("/admin/approvals");
  return { ok: true, data: { status: info.status } };
}
