import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { AdjustClient, type StockItemOption } from "./adjust-client";
import type { Location } from "@/lib/types";

export const metadata = { title: "Adjust stock" };
export const dynamic = "force-dynamic";

export default async function AdjustPage() {
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
        title="Adjust stock"
        description="Adjustments are for corrections & shrinkage — ledger history is never edited. Every adjustment is a new, attributed entry with a reason."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load data: {friendlyError(error.message)}
        </p>
      ) : (
        <AdjustClient locations={locations} items={items} />
      )}
    </>
  );
}
