import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { UsersClient, type UserListEntry } from "./users-client";
import { loginEmailToId } from "@/lib/user-login";
import type { Role } from "@/lib/types";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "super_admin") redirect("/admin");

  const supabase = await createClient();
  const [{ data: users }, { data: logins }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, role, user_no, phone, is_active, created_at")
      .order("full_name"),
    supabase.rpc("get_login_status"),
  ]);

  // Profiles with no auth account can't sign in and have no password to reset.
  // The login address also carries the ID they actually type at sign-in,
  // which is the number that matters when the two disagree.
  const loginIds = new Map<string, number | null>(
    ((logins ?? []) as unknown as { id: string; login_email: string | null }[]).map(
      (r) => [r.id, loginEmailToId(r.login_email)]
    )
  );

  const sanitized: UserListEntry[] = (users ?? []).map((u) => ({
    id: u.id as string,
    full_name: u.full_name as string,
    role: u.role as Role,
    user_no: (u.user_no as number | null) ?? null,
    phone: (u.phone as string | null) ?? null,
    has_login: loginIds.has(u.id as string),
    signs_in_as: loginIds.get(u.id as string) ?? null,
    is_active: Boolean(u.is_active),
  }));

  const nextUserNo = Math.max(
    1000,
    ...sanitized.map((u) => u.user_no ?? 1000)
  ) + 1;

  return (
    <>
      <PageHeader
        title="Users"
        description="Department Admins and Heads with their four-digit User IDs."
      />
      <UsersClient users={sanitized} selfId={profile.id} nextUserNo={nextUserNo} />
    </>
  );
}
