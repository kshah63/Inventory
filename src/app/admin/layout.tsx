import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/");
  if (profile.role === "kiosk") redirect("/kiosk");
  if (
    profile.role !== "super_admin" &&
    profile.role !== "procurement" &&
    profile.role !== "dept_head"
  ) {
    redirect("/browse");
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AdminNav
        userName={profile.full_name}
        isSuperAdmin={profile.role === "super_admin"}
        reportingOnly={profile.role === "dept_head"}
      />
      <main className="flex-1 p-4 pb-20 lg:p-8 lg:pb-8 overflow-x-hidden">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
