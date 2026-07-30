"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { idToLoginEmail, isUserId } from "@/lib/user-login";
import type { ActionResult } from "@/lib/types";

/** Look up the real login email behind a four-digit User ID. Used only as a
 * fallback for accounts that were created with a real email address before
 * ID logins existed (e.g. the first super admin). */
async function emailForUserId(userNo: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("id")
      .eq("user_no", Number(userNo))
      .maybeSingle();
    if (!profile?.id) return null;
    const { data } = await admin.auth.admin.getUserById(profile.id);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

/** Sign in with either a four-digit User ID or an email address. */
export async function signIn(
  identifier: string,
  password: string
): Promise<ActionResult> {
  const raw = identifier.trim();
  if (!raw) return { ok: false, error: "Enter your User ID." };

  const byId = isUserId(raw);
  const attempts: string[] = byId
    ? [idToLoginEmail(raw)]
    : [raw.toLowerCase()];

  const supabase = await createClient();
  let lastError = "";

  for (const email of attempts) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return { ok: true, data: undefined };
    lastError = error.message;
  }

  // An ID that isn't an ID-login account may still belong to someone with a
  // real email address on file — resolve it and try once more.
  if (byId && lastError === "Invalid login credentials") {
    const realEmail = await emailForUserId(raw);
    if (realEmail && !attempts.includes(realEmail.toLowerCase())) {
      const { error } = await supabase.auth.signInWithPassword({
        email: realEmail,
        password,
      });
      if (!error) return { ok: true, data: undefined };
      lastError = error.message;
    }
  }

  if (lastError === "Invalid login credentials") {
    return {
      ok: false,
      error: byId ? "Wrong User ID or password." : "Wrong email or password.",
    };
  }
  // Network-level failure: the server can't reach the Supabase project at
  // all — a wrong NEXT_PUBLIC_SUPABASE_URL or a paused project, never a
  // credentials problem. Say so instead of surfacing "fetch failed".
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(lastError)) {
    return {
      ok: false,
      error:
        "Can't reach the database. Check that NEXT_PUBLIC_SUPABASE_URL is exactly " +
        "your project's API URL (https://<ref>.supabase.co) in Vercel and that the " +
        "Supabase project isn't paused, then redeploy.",
    };
  }
  return { ok: false, error: lastError || "Couldn't sign you in." };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** "Forgot your password?" on the login page. Always reports success —
 * whether an account matched is only visible to procurement. */
export async function requestPasswordReset(identifier: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    await supabase.rpc("submit_password_reset", { p_identifier: identifier });
  } catch {
    // Deliberately swallowed — the caller always sees success.
  }
  return { ok: true, data: undefined };
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
