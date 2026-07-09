"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { broadcastToProcurement } from "@/lib/whatsapp";
import type { ActionResult } from "@/lib/types";

export async function updateSetting(
  key: "whatsapp_recipients" | "digest_enabled" | "alerts_enabled",
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

/** Send a test WhatsApp message to all configured recipients. */
export async function sendTestWhatsApp(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: profile } = await supabase.auth.getUser();
  if (!profile.user) return { ok: false, error: "Not signed in." };

  const { data: recipients } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "whatsapp_recipients")
    .single();

  const list = Array.isArray(recipients?.value) ? (recipients.value as string[]) : [];
  if (list.length === 0) {
    return { ok: false, error: "Add at least one recipient number first." };
  }

  await broadcastToProcurement(
    "✅ MathVision Stock — test message. WhatsApp alerts are working!",
    "digest"
  );
  revalidatePath("/admin/settings");
  return { ok: true, data: undefined };
}
