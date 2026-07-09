import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { CatalogItem, Category, Location } from "@/lib/types";
import { BrowseClient } from "./browse-client";

export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const supabase = await createClient();

  const [locationsRes, categoriesRes, itemsRes] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase.from("categories").select("id, name, sort_order").order("sort_order"),
    supabase
      .from("items")
      .select("*, category:categories(name), stock_levels(location_id, qty_on_hand)")
      .eq("is_active", true)
      .order("name"),
  ]);

  const locations = (locationsRes.data ?? []) as unknown as Location[];
  const categories = (categoriesRes.data ?? []) as unknown as Category[];
  const items = (itemsRes.data ?? []) as unknown as CatalogItem[];

  return (
    <div>
      <PageHeader
        title="Browse stock"
        description="Check what's on hand in every room before you walk."
      />
      <BrowseClient items={items} locations={locations} categories={categories} />
    </div>
  );
}
