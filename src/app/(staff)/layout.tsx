import { redirect } from "next/navigation";
import Link from "next/link";
import { getProfile } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { StaffNav } from "@/components/staff-nav";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "kiosk") redirect("/kiosk");

  const isAdmin = profile.role === "super_admin" || profile.role === "procurement";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/browse">
            <Logo />
          </Link>
          <StaffNav userName={profile.full_name} isAdmin={isAdmin} />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 pb-24">{children}</main>
    </div>
  );
}
