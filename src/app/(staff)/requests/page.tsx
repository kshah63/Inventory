import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { Location } from "@/lib/types";
import { RequestsList, type RequestWithJoins } from "./requests-list";
import { NewRequestDialog, type SelectableItem } from "./new-request-dialog";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const supabase = await createClient();

  const [requestsRes, locationsRes, itemsRes] = await Promise.all([
    // RLS limits staff to their own requests.
    supabase
      .from("requests")
      .select("*, items(name, unit), locations(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("items")
      .select("id, name, unit")
      .eq("is_active", true)
      .order("name"),
  ]);

  const requests = (requestsRes.data ?? []) as unknown as RequestWithJoins[];
  const locations = (locationsRes.data ?? []) as unknown as Location[];
  const items = (itemsRes.data ?? []) as unknown as SelectableItem[];

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Ask procurement to restock something or order a new item."
      >
        <NewRequestDialog items={items} locations={locations} />
      </PageHeader>
      <RequestsList requests={requests} />
    </div>
  );
}
