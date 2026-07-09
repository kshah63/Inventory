import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { TransferClient, type StockItemOption } from "./transfer-client";
import type { Location } from "@/lib/types";

export const metadata = { title: "Transfer stock" };
export const dynamic = "force-dynamic";

export default async function TransferPage() {
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
        title="Transfer stock"
        description="Move stock between rooms — both sides are recorded as one linked movement in the ledger."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load data: {friendlyError(error.message)}
        </p>
      ) : (
        <TransferClient locations={locations} items={items} />
      )}
    </>
  );
}
