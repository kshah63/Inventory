import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { UsersClient, type UserListEntry } from "./users-client";
import type { Location, Role } from "@/lib/types";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "super_admin") redirect("/admin");

  const supabase = await createClient();
  const [{ data: users }, { data: locations }] = await Promise.all([
    supabase
      .from("users")
      .select(
        "id, full_name, role, user_no, phone, kiosk_location_id, is_active, created_at"
      )
      .order("full_name"),
    supabase.from("locations").select("id, name, is_active").eq("is_active", true).order("name"),
  ]);

  const sanitized: UserListEntry[] = (users ?? []).map((u) => ({
    id: u.id as string,
    full_name: u.full_name as string,
    role: u.role as Role,
    user_no: (u.user_no as number | null) ?? null,
    phone: (u.phone as string | null) ?? null,
    kiosk_location_id: (u.kiosk_location_id as string | null) ?? null,
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
        description="Department Admins and Heads with their four-digit User IDs. Procurement and Super Admin accounts are managed from the back end."
      />
      <UsersClient
        users={sanitized}
        locations={(locations ?? []) as Location[]}
        selfId={profile.id}
        nextUserNo={nextUserNo}
      />
    </>
  );
}
