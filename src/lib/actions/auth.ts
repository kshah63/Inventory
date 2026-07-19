"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export async function signIn(
  email: string,
  password: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    if (error.message === "Invalid login credentials") {
      return { ok: false, error: "Wrong email or password." };
    }
    // Network-level failure: the server can't reach the Supabase project at
    // all — a wrong NEXT_PUBLIC_SUPABASE_URL or a paused project, never a
    // credentials problem. Say so instead of surfacing "fetch failed".
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(error.message)) {
      return {
        ok: false,
        error:
          "Can't reach the database. Check that NEXT_PUBLIC_SUPABASE_URL is exactly " +
          "your project's API URL (https://<ref>.supabase.co) in Vercel and that the " +
          "Supabase project isn't paused, then redeploy.",
      };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, data: undefined };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changeOwnPassword(newPassword: string): Promise<ActionResult> {
  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}
