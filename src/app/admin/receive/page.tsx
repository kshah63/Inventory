import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { ReceiveClient, type StockItemOption } from "./receive-client";
import type { Location } from "@/lib/types";

export const metadata = { title: "Receive stock" };
export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const supabase = await createClient();
  const [locRes, itemRes] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("items")
      .select("id, sku, name, unit, category:categories(name), stock_levels(location_id, qty_on_hand)")
      .eq("is_active", true)
      .order("name"),
  ]);

  const error = locRes.error ?? itemRes.error;
  const locations = (locRes.data ?? []) as unknown as Location[];
  const items = (itemRes.data ?? []) as unknown as StockItemOption[];

  return (
    <>
      <PageHeader
        title="Receive stock"
        description="Log an incoming delivery — pick the room it goes into, add the items on the packing list, and confirm."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load data: {friendlyError(error.message)}
        </p>
      ) : (
        <ReceiveClient locations={locations} items={items} />
      )}
    </>
  );
}
