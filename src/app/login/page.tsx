import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const profile = await getProfile();
  if (profile) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-navy-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="scale-125" />
          <p className="text-sm text-muted-foreground">
            Procurement & inventory for Level 8 and Basement store rooms
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          No account? Ask a super admin to invite you.
          <br />
          Kiosk tablets sign in with their device account.
        </p>
      </div>
    </main>
  );
}
