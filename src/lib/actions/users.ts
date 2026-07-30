"use server";

import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { idToLoginEmail, isIdLoginEmail } from "@/lib/user-login";
import type { ActionResult, Role } from "@/lib/types";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

async function requireSuperAdmin(): Promise<ActionResult<string>> {
  const profile = await getProfile();
  if (!profile || profile.role !== "super_admin") {
    return { ok: false, error: "You don't have permission to manage users." };
  }
  return { ok: true, data: profile.id };
}

/** Super admin accounts are protected from each other: only the owner may
 * change one. Returns an error result when the target is someone else's
 * super admin account. */
async function guardOtherSuperAdmin(
  targetUserId: string,
  actorId: string
): Promise<{ ok: false; error: string } | null> {
  if (targetUserId === actorId) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("users")
      .select("role")
      .eq("id", targetUserId)
      .single();
    if (data?.role === "super_admin") {
      return {
        ok: false,
        error: "Super admin accounts can only be changed by their owner.",
      };
    }
  } catch {
    // If we can't verify, fail closed for safety.
    return { ok: false, error: "Couldn't verify that account — try again." };
  }
  return null;
}

async function requireProcurement(): Promise<
  ActionResult<{ id: string; role: string }>
> {
  const profile = await getProfile();
  if (!profile || (profile.role !== "super_admin" && profile.role !== "procurement")) {
    return { ok: false, error: "You don't have permission to do that." };
  }
  return { ok: true, data: { id: profile.id, role: profile.role } };
}

/** Create a login for a Department Admin or Department Head. Procurement
 * and Super Admin accounts are deliberately NOT creatable from the app —
 * back end only. Returns a one-time temporary password to share. */
export async function createLoginUser(params: {
  fullName: string;
  role: "staff" | "dept_head";
  userNo: number;
  phone?: string;
}): Promise<ActionResult<{ tempPassword: string }>> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;
  if (params.role !== "staff" && params.role !== "dept_head") {
    return { ok: false, error: "That role can't be assigned here." };
  }
  if (
    !Number.isInteger(params.userNo) ||
    params.userNo < 1000 ||
    params.userNo > 9999
  ) {
    return { ok: false, error: "User ID must be a four-digit number." };
  }
  if (!params.fullName.trim()) {
    return { ok: false, error: "Name is required." };
  }

  // Department teams sign in with their User ID; Supabase needs an address.
  const email = idToLoginEmail(params.userNo);

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Service key missing." };
  }

  const tempPassword = generateTempPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: params.fullName.trim() },
    app_metadata: { role: params.role, user_no: params.userNo },
  });
  if (error) {
    if (/already/i.test(error.message)) {
      return { ok: false, error: `User ID ${params.userNo} is already in use.` };
    }
    return { ok: false, error: error.message };
  }

  // The handle_new_user trigger created the profile; enrich it.
  await admin
    .from("users")
    .update({ phone: params.phone?.trim() || null })
    .eq("id", created.user.id);

  revalidatePath("/admin/users");
  return { ok: true, data: { tempPassword } };
}

/** Give an existing profile a login, keeping their history: creates the auth
 * account with the SAME id as the profile, so nothing is orphaned. Used for
 * people who were added before ID logins existed. */
export async function createLoginForExistingUser(
  userId: string
): Promise<ActionResult<{ tempPassword: string; label: string }>> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Service key missing." };
  }

  // Already has a login?
  const { data: existing } = await admin.auth.admin.getUserById(userId);
  if (existing?.user) {
    return { ok: false, error: "This person already has a login." };
  }

  const { data: profile } = await admin
    .from("users")
    .select("full_name, user_no, role")
    .eq("id", userId)
    .single();
  if (!profile) return { ok: false, error: "Profile not found." };
  if (profile.role === "kiosk") {
    return { ok: false, error: "Kiosk devices don't use ID logins." };
  }

  // Make sure they have a User ID to sign in with.
  let userNo = profile.user_no as number | null;
  if (!userNo) {
    const { data: nextNo } = await admin.rpc("get_next_user_no");
    userNo = typeof nextNo === "number" ? nextNo : null;
    if (!userNo) return { ok: false, error: "Couldn't allocate a User ID." };
    const { error: noError } = await admin
      .from("users")
      .update({ user_no: userNo })
      .eq("id", userId);
    if (noError) return { ok: false, error: noError.message };
  }

  const tempPassword = generateTempPassword();
  // Create the auth account with the profile's own id so their existing
  // history stays attached. GoTrue accepts an explicit id on admin create.
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: userId,
      email: idToLoginEmail(userNo),
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: profile.full_name },
      app_metadata: { role: profile.role, user_no: userNo },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    if (/already|duplicate/i.test(detail)) {
      return { ok: false, error: `User ID ${userNo} is already in use by another login.` };
    }
    return { ok: false, error: `Couldn't create the login: ${detail.slice(0, 200)}` };
  }

  // If this Supabase version ignored our id, the new account would be
  // detached from their history — undo it rather than leave a duplicate.
  const created = (await res.json().catch(() => null)) as { id?: string } | null;
  if (created?.id && created.id !== userId) {
    await admin.auth.admin.deleteUser(created.id).catch(() => {});
    return {
      ok: false,
      error:
        "This Supabase project won't link a login to an existing profile. Add them as a new user instead.",
    };
  }

  revalidatePath("/admin/users");
  return {
    ok: true,
    data: {
      tempPassword,
      label: `${profile.full_name} — User ID ${userNo}`,
    },
  };
}

/** Create a kiosk device account pinned to a location. */
export async function createKioskDevice(params: {
  email: string;
  locationId: string;
  locationName: string;
}): Promise<ActionResult<{ tempPassword: string }>> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;

  const email = params.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Service key missing." };
  }

  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: `Kiosk — ${params.locationName}` },
    app_metadata: { role: "kiosk", kiosk_location_id: params.locationId },
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  return { ok: true, data: { tempPassword } };
}

/** Create a kiosk-only staff member (PIN user with no email login). */
export async function createPinOnlyStaff(params: {
  fullName: string;
  department?: string;
  phone?: string;
  pin: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_staff_member", {
    p_full_name: params.fullName,
    p_department: params.department ?? null,
    p_phone: params.phone ?? null,
    p_pin: params.pin,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}

export async function updateUser(params: {
  userId: string;
  fullName?: string;
  phone?: string;
  role?: Role;
  userNo?: number;
  isActive?: boolean;
  kioskLocationId?: string;
}): Promise<ActionResult> {
  // Role changes from the app are limited to the two department roles;
  // procurement/super admin assignments happen on the back end only.
  if (params.role && params.role !== "staff" && params.role !== "dept_head") {
    return { ok: false, error: "That role can't be assigned here." };
  }
  if (
    params.userNo !== undefined &&
    (!Number.isInteger(params.userNo) || params.userNo < 1000 || params.userNo > 9999)
  ) {
    return { ok: false, error: "User ID must be a four-digit number." };
  }
  // An ID-login account's address is derived from its User ID — move the
  // login first so the two can never drift apart.
  if (params.userNo !== undefined) {
    try {
      const admin = createAdminClient();
      const { data: current } = await admin
        .from("users")
        .select("user_no")
        .eq("id", params.userId)
        .maybeSingle();
      if (current && current.user_no !== params.userNo) {
        const { data: authUser } = await admin.auth.admin.getUserById(params.userId);
        if (isIdLoginEmail(authUser?.user?.email)) {
          const { error: emailError } = await admin.auth.admin.updateUserById(
            params.userId,
            { email: idToLoginEmail(params.userNo), email_confirm: true }
          );
          if (emailError) {
            return {
              ok: false,
              error: /already/i.test(emailError.message)
                ? `User ID ${params.userNo} is already in use.`
                : `Couldn't move the login to ID ${params.userNo}: ${emailError.message}`,
            };
          }
        }
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Couldn't update the login ID.",
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_user_profile", {
    p_user_id: params.userId,
    p_full_name: params.fullName ?? null,
    p_department: null,
    p_phone: params.phone ?? null,
    p_role: params.role ?? null,
    p_is_active: params.isActive ?? null,
    p_kiosk_location_id: params.kioskLocationId ?? null,
    p_user_no: params.userNo ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}

export async function setUserPin(userId: string, pin: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/users");
  return { ok: true, data: undefined };
}

/** Revoke every active session for a user. Their open tabs lose access
 * once the current access token expires (JWT expiry setting in Supabase,
 * 1h by default) — pair with Deactivate for an instant data-level lockout. */
export async function signOutUserEverywhere(userId: string): Promise<ActionResult> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;
  const blocked = await guardOtherSuperAdmin(userId, guard.data);
  if (blocked) return blocked;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." };
  }

  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}/logout`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false,
          error: "This user has no login account — nothing to sign out.",
        };
      }
      const detail = await res.text().catch(() => res.statusText);
      return { ok: false, error: `Could not revoke sessions: ${detail.slice(0, 200)}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error." };
  }
  return { ok: true, data: undefined };
}

/** Handle a "forgot password" request from the dashboard queue: sets a new
 * temporary password on the matched account and marks the request done. */
export async function fulfillPasswordReset(
  requestId: string
): Promise<ActionResult<{ tempPassword: string; label: string }>> {
  const guard = await requireProcurement();
  if (!guard.ok) return guard;

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Service key missing." };
  }

  const { data: request } = await admin
    .from("password_reset_requests")
    .select("id, status, matched_user")
    .eq("id", requestId)
    .single();
  if (!request || request.status !== "open") {
    return { ok: false, error: "That request was already handled." };
  }
  if (!request.matched_user) {
    return {
      ok: false,
      error: "No matching account for that request — dismiss it and follow up in person.",
    };
  }

  const { data: target } = await admin
    .from("users")
    .select("full_name, user_no, role")
    .eq("id", request.matched_user)
    .single();
  if (!target) return { ok: false, error: "Account not found." };
  if (target.role === "super_admin" && request.matched_user !== guard.data.id) {
    return {
      ok: false,
      error:
        "Super admin accounts can only be reset by their owner — they can do it from the Supabase dashboard.",
    };
  }

  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(request.matched_user, {
    password: tempPassword,
  });
  if (error) return { ok: false, error: error.message };

  await admin
    .from("password_reset_requests")
    .update({ status: "done", handled_by: guard.data.id, handled_at: new Date().toISOString() })
    .eq("id", requestId);

  revalidatePath("/admin");
  return {
    ok: true,
    data: {
      tempPassword,
      label: `${target.full_name}${target.user_no ? ` (ID ${target.user_no})` : ""}`,
    },
  };
}

export async function dismissResetRequest(requestId: string): Promise<ActionResult> {
  const guard = await requireProcurement();
  if (!guard.ok) return guard;

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Service key missing." };
  }
  const { error } = await admin
    .from("password_reset_requests")
    .update({
      status: "dismissed",
      handled_by: guard.data.id,
      handled_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "open");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true, data: undefined };
}

/** Reset a login user's password (returns a new temporary password). */
export async function resetUserPassword(
  userId: string
): Promise<ActionResult<{ tempPassword: string }>> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;
  const blocked = await guardOtherSuperAdmin(userId, guard.data);
  if (blocked) return blocked;

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Service key missing." };
  }

  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { tempPassword } };
}
