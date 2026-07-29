"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  broadcastToProcurement,
  composeApprovalAlert,
  composeOutOfStockAlert,
} from "@/lib/whatsapp";
import type {
  ActionResult,
  BasketLine,
  CheckoutResult,
  KioskSessionInfo,
} from "@/lib/types";

export async function startKioskSession(
  userId: string,
  pin: string
): Promise<ActionResult<KioskSessionInfo>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kiosk_start_session", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) return { ok: false, error: error.message };

  // PIN failures come back as a value (not a raised error) so the DB commits
  // the rate-limit counters; map them onto the same ActionResult shape.
  const result = data as {
    ok: boolean;
    error?: string;
    token?: string;
    user_id?: string;
    full_name?: string;
  };
  if (!result.ok) return { ok: false, error: result.error ?? "PIN_INVALID" };
  return {
    ok: true,
    data: {
      token: result.token!,
      user_id: result.user_id!,
      full_name: result.full_name!,
    },
  };
}

export async function endKioskSession(token: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("kiosk_end_session", { p_token: token });
}

export async function kioskCheckout(
  token: string,
  lines: BasketLine[],
  zone?: string | null
): Promise<ActionResult<CheckoutResult>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kiosk_checkout", {
    p_token: token,
    p_lines: lines,
    p_zone: zone ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const result = data as CheckoutResult;

  // Immediate out-of-stock alerts (fire-and-forget semantics; never block
  // or fail the checkout).
  if (result.hit_zero?.length) {
    await Promise.all(
      result.hit_zero.map((z) =>
        broadcastToProcurement(composeOutOfStockAlert(z), "out_of_stock")
      )
    ).catch(() => {});
  }

  revalidatePath("/kiosk");
  return { ok: true, data: result };
}

export async function kioskReturn(
  token: string,
  itemId: string,
  qty: number,
  note?: string
): Promise<ActionResult<{ name: string; unit: string; qty: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kiosk_return", {
    p_token: token,
    p_item_id: itemId,
    p_qty: qty,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/kiosk");
  return { ok: true, data: data as { name: string; unit: string; qty: number } };
}

export async function kioskRequestApproval(
  token: string,
  itemId: string,
  qty: number
): Promise<ActionResult<{ item_name: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kiosk_request_approval", {
    p_token: token,
    p_item_id: itemId,
    p_qty: qty,
  });
  if (error) return { ok: false, error: error.message };

  const info = data as {
    item_name: string;
    unit: string;
    qty: number;
    requester_name: string;
    location_name: string;
  };

  await broadcastToProcurement(
    composeApprovalAlert(info),
    "approval_needed"
  ).catch(() => {});

  return { ok: true, data: { item_name: info.item_name } };
}

export async function kioskCreateRequest(
  token: string,
  params: {
    itemId: string | null;
    freeText: string | null;
    qty: number;
    note?: string;
  }
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("kiosk_create_request", {
    p_token: token,
    p_item_id: params.itemId,
    p_free_text: params.freeText,
    p_qty: params.qty,
    p_note: params.note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}
