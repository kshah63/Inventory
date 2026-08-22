import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { ReceiveClient, type StockItemOption } from "./receive-client";
import { TransferClient } from "./transfer-client";
import { AdjustClient } from "./adjust-client";
import { StockTabs } from "./stock-tabs";
import type { Location } from "@/lib/types";

export const metadata = { title: "Update stock" };
export const dynamic = "force-dynamic";

/** Receiving, transferring and adjusting all answer one question — what
 * happened to the count? — so they're one screen with the answer up front.
 * The three forms stay distinct because the jobs genuinely are: a delivery
 * is a list, a move has two ends, a recount needs a reason. */
export default async function UpdateStockPage() {
  const supabase = await createClient();
  const [locRes, itemRes] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("items")
      .select(
        "id, sku, name, unit, category:categories(name), stock_levels(location_id, qty_on_hand)"
      )
      .eq("is_active", true)
      .order("name"),
  ]);

  const error = locRes.error ?? itemRes.error;
  const locations = (locRes.data ?? []) as unknown as Location[];
  const items = (itemRes.data ?? []) as unknown as StockItemOption[];

  return (
    <>
      <PageHeader
        title="Update stock"
        description="Anything that changes a count and isn't somebody collecting an order."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load data: {friendlyError(error.message)}
        </p>
      ) : (
        <StockTabs
          received={<ReceiveClient locations={locations} items={items} />}
          moved={<TransferClient locations={locations} items={items} />}
          recount={<AdjustClient locations={locations} items={items} />}
        />
      )}
    </>
  );
}
