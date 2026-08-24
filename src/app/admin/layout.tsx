import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/");
  // Department Heads had read-only Reports and the audit log; that's paused
  // for now, so admin screens are procurement and super admin only.
  if (profile.role !== "super_admin" && profile.role !== "procurement") {
    redirect("/browse");
  }

  // What's genuinely waiting on this team, for the To do badges. Deliberately
  // not "everything open": an order that's packed and a request that's out
  // with the supplier are both waiting on somebody else, and counting them
  // here would make the badge a number nobody can bring down.
  const supabase = await createClient();
  const [orderCount, requestCount, claimCount] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "acknowledged", "received"]),
    supabase
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("status", "requested"),
  ]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AdminNav
        userName={profile.full_name}
        isSuperAdmin={profile.role === "super_admin"}
        todo={{
          orders: orderCount.count ?? 0,
          requests: requestCount.count ?? 0,
          claims: claimCount.count ?? 0,
        }}
      />
      <main className="flex-1 p-4 pb-20 lg:p-8 lg:pb-8 overflow-x-hidden">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
