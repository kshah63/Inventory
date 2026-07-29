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

/** Staff (own device) creates a request — RLS enforces requested_by = self. */
export async function createRequest(params: {
  itemId: string | null;
  freeText: string | null;
  qty: number;
  locationId: string;
  zone?: string | null;
  note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!params.itemId && !params.freeText?.trim()) {
    return { ok: false, error: "Pick an item or describe what you need." };
  }
  if (!params.qty || params.qty <= 0) return { ok: false, error: "Quantity must be positive." };

  const { error } = await supabase.from("requests").insert({
    requested_by: user.id,
    item_id: params.itemId,
    free_text_item: params.freeText?.trim() || null,
    qty: params.qty,
    location_id: params.locationId,
    zone: params.zone?.trim() || null,
    note: params.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/requests");
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
