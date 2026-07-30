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
    .in("key", ["whatsapp_recipients", "digest_enabled", "alerts_enabled", "zones"]);

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));

  const raw = map.get("whatsapp_recipients");
  const recipients = Array.isArray(raw) ? (raw as string[]) : [];
  const rawZones = map.get("zones");
  const zones = Array.isArray(rawZones) ? (rawZones as string[]) : [];
  // Both flags are seeded true — treat a missing row the same way.
  const digestEnabled = map.get("digest_enabled") !== false;
  const alertsEnabled = map.get("alerts_enabled") !== false;

  return (
    <>
      <PageHeader
        title="Settings"
        description="WhatsApp notifications, zones, and your account."
      />
      <SettingsClient
        initialRecipients={recipients}
        initialDigestEnabled={digestEnabled}
        initialAlertsEnabled={alertsEnabled}
        initialZones={zones}
      />
      {profile?.role === "super_admin" && (
        <div className="mt-6">
          <ConnectionCheck />
        </div>
      )}
    </>
  );
}
