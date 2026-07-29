import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { CatalogItem, Category, Location } from "@/lib/types";
import { CatalogueClient } from "./catalogue-client";

export const metadata = { title: "Catalogue" };
export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  const supabase = await createClient();

  const [locationsRes, categoriesRes, itemsRes, zonesRes] = await Promise.all([
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
    supabase.from("settings").select("value").eq("key", "zones").maybeSingle(),
  ]);

  const locations = (locationsRes.data ?? []) as unknown as Location[];
  const categories = (categoriesRes.data ?? []) as unknown as Category[];
  const items = (itemsRes.data ?? []) as unknown as CatalogItem[];
  const zones = Array.isArray(zonesRes.data?.value)
    ? (zonesRes.data.value as unknown[]).filter((z): z is string => typeof z === "string")
    : [];

  return (
    <div>
      <PageHeader
        title="Order supplies"
        description="Add what you need, place the order, and the procurement team will pack it for collection."
      />
      <CatalogueClient
        items={items}
        locations={locations}
        categories={categories}
        zones={zones}
      />
    </div>
  );
}
