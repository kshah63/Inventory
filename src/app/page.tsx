import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  if (!profile.is_active) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <Logo />
        <p className="max-w-sm text-muted-foreground">
          This account has been deactivated. Contact the procurement team if
          you think that&apos;s a mistake.
        </p>
        <form action={signOut}>
          <Button variant="outline">Sign out</Button>
        </form>
      </main>
    );
  }

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
