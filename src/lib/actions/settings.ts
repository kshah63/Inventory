"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export async function updateSetting(
  key: "zones",
  value: unknown
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true, data: undefined };
}
