import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";

export const metadata = { title: "Kiosk" };

export default async function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // Kiosk device accounts run this; admins may open it to test.
  if (
    profile.role !== "kiosk" &&
    profile.role !== "super_admin" &&
    profile.role !== "procurement"
  ) {
    redirect("/browse");
  }

  return <div className="kiosk-root min-h-screen bg-background">{children}</div>;
}
