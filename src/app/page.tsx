import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/login?error=deactivated");

  switch (profile.role) {
    case "kiosk":
      redirect("/kiosk");
    case "super_admin":
    case "procurement":
      redirect("/admin");
    default:
      redirect("/browse");
  }
}
