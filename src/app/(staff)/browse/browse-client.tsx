"use client";

import * as React from "react";
import { Lock, Package, Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { CatalogItem, Category, Location } from "@/lib/types";

export function BrowseClient({
  items,
  locations,
  categories,
}: {
  items: CatalogItem[];
  locations: Location[];
  categories: Category[];
}) {
  const [query, setQuery] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryId && item.category_id !== categoryId) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)
      );
    });
  }, [items, query, categoryId]);

  // Only show category chips that actually contain active items.
  const usedCategoryIds = React.useMemo(
    () => new Set(items.map((i) => i.category_id)),
    [items]
  );
  const visibleCategories = categories.filter((c) => usedCategoryIds.has(c.id));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or SKU…"
          className="pl-9"
          aria-label="Search items"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <CategoryChip
          label="All"
          active={categoryId === null}
          onClick={() => setCategoryId(null)}
        />
        {visibleCategories.map((cat) => (
          <CategoryChip
            key={cat.id}
            label={cat.name}
            active={categoryId === cat.id}
            onClick={() => setCategoryId(cat.id)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No items found"
          description="Try a different search term or category."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {filtered.length} item{filtered.length === 1 ? "" : "s"}
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filtered.map((item) => (
              <ItemCard key={item.id} item={item} locations={locations} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {label}
    </button>
  );
}

function ItemCard({ item, locations }: { item: CatalogItem; locations: Location[] }) {
  const qtyByLocation = new Map(
    item.stock_levels.map((s) => [s.location_id, s.qty_on_hand])
  );

  return (
    <li className="flex gap-3 rounded-lg border bg-card p-4 shadow-sm">
      {item.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.photo_url}
          alt={item.name}
          className="h-14 w-14 shrink-0 rounded-md border object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted">
          <Package className="h-6 w-6 text-muted-foreground/50" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{item.name}</p>
            <p className="text-xs text-muted-foreground">
              {item.sku} · per {item.unit}
              {item.category?.name ? ` · ${item.category.name}` : ""}
            </p>
          </div>
          {item.requires_approval && (
            <Badge variant="warning" className="shrink-0 gap-1">
              <Lock className="h-3 w-3" />
              Needs approval
            </Badge>
          )}
        </div>

        <p className="mt-2 text-sm">
          {locations.map((loc, i) => {
            const qty = qtyByLocation.get(loc.id) ?? 0;
            return (
              <span key={loc.id} className="whitespace-nowrap">
                {i > 0 && <span className="mx-1.5 text-muted-foreground/50">·</span>}
                <span className="text-muted-foreground">{loc.name}: </span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    qty === 0 ? "text-destructive" : "text-success"
                  )}
                >
                  {qty}
                </span>
              </span>
            );
          })}
        </p>
      </div>
    </li>
  );
}
