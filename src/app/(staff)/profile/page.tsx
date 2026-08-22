import { redirect } from "next/navigation";
import { BadgeCheck, Phone } from "lucide-react";
import { getProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@/lib/types";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "My profile" };
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  procurement: "Procurement",
  staff: "Department Admin",
  dept_head: "Department Head",
  kiosk: "Kiosk device",
};

export default async function ProfilePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div>
      <PageHeader
        title="My profile"
        description="Your sign-in details and password."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeCheck className="h-4 w-4 text-muted-foreground" />
              Your details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{profile.full_name}</dd>

              <dt className="text-muted-foreground">User ID</dt>
              <dd>
                {profile.user_no ? (
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {profile.user_no}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                {profile.user_no && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    this is what you sign in with
                  </span>
                )}
              </dd>

              <dt className="text-muted-foreground">Role</dt>
              <dd>
                <Badge variant="secondary">{ROLE_LABELS[profile.role]}</Badge>
              </dd>

              <dt className="text-muted-foreground">Phone number</dt>
              <dd className="text-muted-foreground">
                {profile.phone ? (
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    {profile.phone}
                  </span>
                ) : (
                  "Not set"
                )}
              </dd>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Need your name, ID or number changed? Ask the procurement team.
            </p>
          </CardContent>
        </Card>

        <ChangePasswordForm />
      </div>
    </div>
  );
}
