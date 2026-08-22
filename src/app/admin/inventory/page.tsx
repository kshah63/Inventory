import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { InventoryGrid, type InventoryItem } from "./inventory-grid";
import type { Category, Location } from "@/lib/types";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ stock?: string }>;
}) {
  // The dashboard's low/out-of-stock cards link straight into this filter.
  const { stock } = await searchParams;
  const initialStockFilter =
    stock === "out" || stock === "low" || stock === "in" ? stock : "all";
  const supabase = await createClient();
  const [catRes, locRes, itemRes] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, sort_order")
      .order("sort_order")
      .order("name"),
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("items")
      .select(
        "*, category:categories(name), stock_levels(location_id, qty_on_hand, reorder_point, par_level)"
      )
      .order("name"),
  ]);

  const error = catRes.error ?? locRes.error ?? itemRes.error;
  const categories = (catRes.data ?? []) as unknown as Category[];
  const locations = (locRes.data ?? []) as unknown as Location[];
  const items = (itemRes.data ?? []) as unknown as InventoryItem[];

  return (
    <>
      <PageHeader
        title="Inventory"
        description="The item catalog and stock parameters per location. Quantities change through checkouts, receiving, transfers and adjustments — not here."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load inventory: {friendlyError(error.message)}
        </p>
      ) : (
        <InventoryGrid items={items} categories={categories} locations={locations} />
      )}
    </>
  );
}
