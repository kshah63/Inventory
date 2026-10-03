import { Hand, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { friendlyError, timeAgo } from "@/lib/utils";

export const metadata = { title: "Expressed interest" };
export const dynamic = "force-dynamic";

interface Row {
  item_id: string;
  user_id: string;
  created_at: string;
}

export default async function InterestPage() {
  const supabase = await createClient();

  const { data: rowsData, error } = await supabase
    .from("item_interest")
    .select("item_id, user_id, created_at")
    .order("created_at", { ascending: false });
  const rows = (rowsData ?? []) as Row[];

  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];

  const [itemsRes, usersRes] = await Promise.all([
    itemIds.length
      ? supabase
          .from("items")
          .select("id, name, sku, category:categories(name), stock_levels(qty_on_hand)")
          .in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("users").select("id, full_name, user_no").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const itemById = new Map(
    ((itemsRes.data ?? []) as unknown as {
      id: string;
      name: string;
      sku: string;
      category: { name: string } | null;
      stock_levels: { qty_on_hand: number }[];
    }[]).map((i) => [i.id, i])
  );
  const userById = new Map(
    ((usersRes.data ?? []) as { id: string; full_name: string; user_no: number | null }[]).map(
      (u) => [u.id, u]
    )
  );

  // One entry per item, with who asked and when, most-wanted first.
  const byItem = new Map<
    string,
    { item_id: string; people: { name: string; user_no: number | null; at: string }[] }
  >();
  for (const r of rows) {
    const e = byItem.get(r.item_id) ?? { item_id: r.item_id, people: [] };
    const u = userById.get(r.user_id);
    e.people.push({
      name: u?.full_name ?? "Someone",
      user_no: u?.user_no ?? null,
      at: r.created_at,
    });
    byItem.set(r.item_id, e);
  }
  const items = [...byItem.values()]
    .map((e) => {
      const item = itemById.get(e.item_id);
      const stock = (item?.stock_levels ?? []).reduce((n, s) => n + s.qty_on_hand, 0);
      return { ...e, item, stock };
    })
    .sort((a, b) => b.people.length - a.people.length);

  return (
    <>
      <PageHeader
        title="Expressed interest"
        description="What people said they'd want while it was out of stock — a demand signal, not a request. Nothing here needs actioning; it's here to help decide what's worth restocking."
      />

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load interest: {friendlyError(error.message)}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Hand}
          title="No interest expressed yet"
          description="When an item is out of stock, people can tap “Express interest” in the catalogue — those items show up here."
        />
      ) : (
        <div className="space-y-3">
          {items.map((e) => (
            <div key={e.item_id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{e.item?.name ?? "Item"}</span>
                {e.item?.sku && (
                  <span className="text-xs text-muted-foreground">{e.item.sku}</span>
                )}
                {e.item?.category?.name && (
                  <Badge variant="outline">{e.item.category.name}</Badge>
                )}
                {e.stock === 0 ? (
                  <Badge variant="destructive">Out of stock</Badge>
                ) : (
                  <Badge variant="secondary" title="Back in stock — this interest may be stale">
                    {e.stock} in stock now
                  </Badge>
                )}
                <Badge variant="warning" className="ml-auto gap-1">
                  <Hand className="h-3 w-3" /> {e.people.length} interested
                </Badge>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {e.people.map((p, i) => (
                  <li
                    key={i}
                    className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs"
                    title={`Expressed interest ${timeAgo(p.at)}`}
                  >
                    {p.name}
                    {p.user_no ? ` · ${p.user_no}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
