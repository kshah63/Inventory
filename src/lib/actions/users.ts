"use server";

import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
    return { ok: false, error: "Only super admins can manage users." };
  }
  return { ok: true, data: profile.id };
}

/** Create a login (auth user) for an admin/procurement/staff member.
 * Returns a one-time temporary password to share with them. */
export async function createLoginUser(params: {
  email: string;
  fullName: string;
  role: Exclude<Role, "kiosk">;
  department?: string;
  phone?: string;
  pin?: string;
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
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: params.fullName.trim() },
    app_metadata: { role: params.role },
  });
  if (error) return { ok: false, error: error.message };

  // The handle_new_user trigger created the profile; enrich it.
  await admin
    .from("users")
    .update({
      department: params.department?.trim() || null,
      phone: params.phone?.trim() || null,
    })
    .eq("id", created.user.id);

  if (params.pin) {
    const supabase = await createClient();
    const { error: pinError } = await supabase.rpc("set_user_pin", {
      p_user_id: created.user.id,
      p_pin: params.pin,
    });
    if (pinError) {
      return {
        ok: true,
        data: { tempPassword },
      };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true, data: { tempPassword } };
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
  department?: string;
  phone?: string;
  role?: Role;
  isActive?: boolean;
  kioskLocationId?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_user_profile", {
    p_user_id: params.userId,
    p_full_name: params.fullName ?? null,
    p_department: params.department ?? null,
    p_phone: params.phone ?? null,
    p_role: params.role ?? null,
    p_is_active: params.isActive ?? null,
    p_kiosk_location_id: params.kioskLocationId ?? null,
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

/** Reset a login user's password (returns a new temporary password). */
export async function resetUserPassword(
  userId: string
): Promise<ActionResult<{ tempPassword: string }>> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;

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
