import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RequestsList, type RequestWithJoins } from "./requests-list";
import { NewRequestDialog } from "./new-request-dialog";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const supabase = await createClient();

  const [requestsRes, zonesRes] = await Promise.all([
    // RLS limits staff to their own requests.
    supabase
      .from("requests")
      .select("*, items(name, unit)")
      .order("created_at", { ascending: false }),
    supabase.from("settings").select("value").eq("key", "zones").maybeSingle(),
  ]);

  const requests = (requestsRes.data ?? []) as unknown as RequestWithJoins[];
  const zones = Array.isArray(zonesRes.data?.value)
    ? (zonesRes.data.value as unknown[]).filter((z): z is string => typeof z === "string")
    : [];

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Items the catalogue doesn't carry. For anything we stock, use the Catalogue."
      >
        <NewRequestDialog zones={zones} />
      </PageHeader>
      <RequestsList requests={requests} />
    </div>
  );
}
