import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { StaffNav } from "@/components/staff-nav";

// The unread count has to be read on every request, not baked into a build.
export const dynamic = "force-dynamic";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/");

  const isAdmin = profile.role === "super_admin" || profile.role === "procurement";
  const isDeptHead = profile.role === "dept_head";

  // Orders procurement has moved on since this person last looked.
  const supabase = await createClient();
  const { data: unread } = await supabase.rpc("unread_order_count");
  const unreadOrders = typeof unread === "number" ? unread : 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/browse">
            <Logo />
          </Link>
          <StaffNav
            userName={profile.full_name}
            isAdmin={isAdmin}
            isDeptHead={isDeptHead}
            unreadOrders={unreadOrders}
          />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 pb-24">{children}</main>
    </div>
  );
}
