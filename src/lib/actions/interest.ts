"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

/** A soft "I'd want this" signal on an out-of-stock catalogue item — no task
 * for procurement, just a demand tally. One per person per item. */
export async function expressInterest(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("express_interest", { p_item_id: itemId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/browse");
  return { ok: true, data: undefined };
}

export async function withdrawInterest(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_interest", { p_item_id: itemId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/browse");
  return { ok: true, data: undefined };
}

/** Dismiss the "back in stock" notices shown to the person who'd expressed
 * interest, once they've seen them. */
export async function markRestockNoticesSeen(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_restock_notices_seen");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/browse");
  return { ok: true, data: undefined };
}
