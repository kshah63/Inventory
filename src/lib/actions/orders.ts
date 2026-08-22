"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  broadcastToProcurement,
  composeNewOrderAlert,
  composeOrderUpdate,
  sendWhatsApp,
} from "@/lib/whatsapp";
import type { ActionResult, BasketLine } from "@/lib/types";

/** Staff pre-orders from their own device; procurement packs it. */
export async function createOrder(params: {
  locationId: string;
  zone: string | null;
  lines: BasketLine[];
  note?: string;
}): Promise<ActionResult<{ order_no: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_location_id: params.locationId,
    p_zone: params.zone,
    p_lines: params.lines,
    p_note: params.note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const info = data as {
    order_no: number;
    total_units: number;
    requester_name: string;
    location_name: string;
  };

  await broadcastToProcurement(
    composeNewOrderAlert(info),
    "approval_needed"
  ).catch(() => {});

  revalidatePath("/orders");
  return { ok: true, data: { order_no: info.order_no } };
}

/** Called when the requester opens My orders — clears the unread marker on
 * the tab. Failing quietly is right here: it's a read receipt, not the page. */
export async function markOrdersSeen(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("mark_orders_seen");
  revalidatePath("/orders", "layout");
}

/** Change your mind while the order is still yours to change. Procurement
 * starts counting the moment it's packed, so this stops there. */
export async function editOrder(params: {
  orderId: string;
  lines: BasketLine[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_order", {
    p_order_id: params.orderId,
    p_lines: params.lines,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders");
  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}

/** The person picking it up ticks it off. Procurement can too. */
export async function markOrderCollected(orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("collect_order", { p_order_id: orderId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders");
  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}

export async function cancelOrder(orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders");
  return { ok: true, data: undefined };
}

/** Procurement packs the order: stock is decremented (attributed to the
 * requester), status → ready, requester notified. */
export async function packOrder(params: {
  orderId: string;
  locationId: string;
  lines: { item_id: string; qty: number }[];
  note?: string;
}): Promise<ActionResult<{ order_no: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pack_order", {
    p_order_id: params.orderId,
    p_location_id: params.locationId,
    p_lines: params.lines,
    p_note: params.note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const info = data as {
    order_no: number;
    total_units: number;
    requester_phone: string | null;
    location_name: string;
  };

  if (info.requester_phone) {
    await sendWhatsApp(
      info.requester_phone,
      composeOrderUpdate({
        order_no: info.order_no,
        total_units: info.total_units,
        status: "ready",
        location_name: info.location_name,
        admin_note: params.note,
      }),
      "request_update"
    ).catch(() => {});
  }

  revalidatePath("/admin/orders");
  return { ok: true, data: { order_no: info.order_no } };
}

export async function collectOrder(orderId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("collect_order", { p_order_id: orderId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}

export async function rejectOrder(
  orderId: string,
  note?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reject_order", {
    p_order_id: orderId,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const info = data as {
    order_no: number;
    requester_phone: string | null;
    admin_note: string | null;
  };
  if (info.requester_phone) {
    await sendWhatsApp(
      info.requester_phone,
      composeOrderUpdate({
        order_no: info.order_no,
        total_units: 1,
        status: "rejected",
        admin_note: info.admin_note,
      }),
      "request_update"
    ).catch(() => {});
  }

  revalidatePath("/admin/orders");
  return { ok: true, data: undefined };
}
