import { createClient, getProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "./settings-client";
import { ConnectionCheck } from "./connection-check";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .eq("key", "zones");

  const rawZones = (data ?? [])[0]?.value as unknown;
  const zones = Array.isArray(rawZones) ? (rawZones as string[]) : [];

  return (
    <>
      <PageHeader title="Settings" description="Zones and your account." />
      <SettingsClient initialZones={zones} />
      {profile?.role === "super_admin" && (
        <div className="mt-6">
          <ConnectionCheck />
        </div>
      )}
    </>
  );
}
