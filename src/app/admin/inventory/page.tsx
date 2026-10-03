import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { InventoryGrid, type InventoryItem } from "./inventory-grid";
import type { Category, ItemGroup, Location } from "@/lib/types";

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
  const [catRes, locRes, itemRes, groupRes, interestRes] = await Promise.all([
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
        "*, category:categories(name), stock_levels(location_id, qty_on_hand)"
      )
      .order("name"),
    supabase.from("item_groups").select("*").order("name"),
    // Admins read every interest row (RLS) — the out-of-stock demand tally.
    supabase.from("item_interest").select("item_id"),
  ]);

  const error = catRes.error ?? locRes.error ?? itemRes.error ?? groupRes.error;
  const categories = (catRes.data ?? []) as unknown as Category[];
  const locations = (locRes.data ?? []) as unknown as Location[];
  const items = (itemRes.data ?? []) as unknown as InventoryItem[];
  const groups = (groupRes.data ?? []) as unknown as ItemGroup[];
  const interestCounts: Record<string, number> = {};
  for (const r of (interestRes.data ?? []) as { item_id: string }[]) {
    interestCounts[r.item_id] = (interestCounts[r.item_id] ?? 0) + 1;
  }

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
        <InventoryGrid
          items={items}
          categories={categories}
          locations={locations}
          groups={groups}
          interestCounts={interestCounts}
        />
      )}
    </>
  );
}
