import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { CatalogItem, Category, ItemGroup, Location } from "@/lib/types";
import { CatalogueClient } from "./catalogue-client";

export const metadata = { title: "Catalogue" };
export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  const supabase = await createClient();

  const [
    locationsRes,
    categoriesRes,
    itemsRes,
    zonesRes,
    aliasRes,
    groupsRes,
    interestRes,
    committedRes,
  ] = await Promise.all([
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
    supabase.from("item_aliases").select("item_id, alias"),
    supabase.from("item_groups").select("*").eq("is_active", true).order("name"),
    // RLS returns only the current user's own interest rows.
    supabase.from("item_interest").select("item_id"),
    // How much of each item is already held by pending orders (everyone's),
    // so the shelf isn't offered twice. Aggregate only — no identities.
    supabase.rpc("item_committed_qty"),
  ]);

  const locations = (locationsRes.data ?? []) as unknown as Location[];
  const categories = (categoriesRes.data ?? []) as unknown as Category[];
  const items = (itemsRes.data ?? []) as unknown as CatalogItem[];
  const groups = (groupsRes.data ?? []) as unknown as ItemGroup[];
  const zones = Array.isArray(zonesRes.data?.value)
    ? (zonesRes.data.value as unknown[]).filter((z): z is string => typeof z === "string")
    : [];

  // The names people actually use, taught by procurement when they resolve a
  // request from stock. Searching should know them as well as the item names.
  const aliases: Record<string, string[]> = {};
  for (const row of (aliasRes.data ?? []) as { item_id: string; alias: string }[]) {
    (aliases[row.item_id] ??= []).push(row.alias);
  }

  const interestedIds = ((interestRes.data ?? []) as { item_id: string }[]).map(
    (r) => r.item_id
  );

  const committed: Record<string, number> = {};
  for (const row of (committedRes.data ?? []) as {
    item_id: string;
    committed: number;
  }[]) {
    committed[row.item_id] = row.committed;
  }

  return (
    <div>
      <PageHeader
        title="Order supplies"
        description="Add what you need, place the order, and the procurement team will pack it for collection."
      />
      <CatalogueClient
        items={items}
        groups={groups}
        locations={locations}
        categories={categories}
        zones={zones}
        aliases={aliases}
        interestedIds={interestedIds}
        committed={committed}
      />
    </div>
  );
}
