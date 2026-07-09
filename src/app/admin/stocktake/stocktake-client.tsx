"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, MapPin, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { applyStocktake } from "@/lib/actions/inventory";
import { cn, friendlyError } from "@/lib/utils";
import type { Location } from "@/lib/types";

/** Slim item shape used by the stock-operation screens. */
export interface StockItemOption {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: { name: string } | null;
  stock_levels: { location_id: string; qty_on_hand: number }[];
}

function onHand(item: StockItemOption, locationId: string): number {
  return (
    item.stock_levels.find((s) => s.location_id === locationId)?.qty_on_hand ?? 0
  );
}

export function StocktakeClient({
  locations,
  items,
}: {
  locations: Location[];
  items: StockItemOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [locationId, setLocationId] = React.useState("");
  const [query, setQuery] = React.useState("");
  // item_id -> raw counted value; blank/absent = skipped
  const [counts, setCounts] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const countedEntries = Object.entries(counts).filter(
    ([, v]) => v.trim() !== ""
  );

  function changeLocation(next: string) {
    if (
      countedEntries.length > 0 &&
      !window.confirm("Switching location clears the counts you've entered. Continue?")
    ) {
      return;
    }
    setLocationId(next);
    setCounts({});
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter(
        (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
      )
    : items;

  const locationName = locations.find((l) => l.id === locationId)?.name ?? "";

  async function submit() {
    const lines = countedEntries.map(([item_id, v]) => ({
      item_id,
      counted_qty: parseInt(v, 10),
    }));
    if (lines.some((l) => !Number.isFinite(l.counted_qty) || l.counted_qty < 0)) {
      toast("Counted quantities must be whole numbers of zero or more.", "error");
      return;
    }
    if (lines.length === 0) return;
    setSubmitting(true);
    const res = await applyStocktake(locationId, lines, note.trim() || undefined);
    setSubmitting(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(
      `${res.data.adjustments} adjustment${res.data.adjustments === 1 ? "" : "s"} recorded.`
    );
    router.push(`/admin/stocktake/${res.data.stocktake_id}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="stocktake-location">Location to count</Label>
        <Select
          id="stocktake-location"
          value={locationId}
          onChange={(e) => changeLocation(e.target.value)}
        >
          <option value="">Choose a location…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      {!locationId ? (
        <EmptyState
          icon={MapPin}
          title="Pick a location to begin"
          description="You'll see every active item with its system quantity — enter what you actually count. Leave a row blank to skip it."
        />
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter items by name or SKU…"
              className="pl-9"
              aria-label="Filter items"
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No items match"
              description="Try a different search term — counts you've already entered are kept."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">System qty</TableHead>
                  <TableHead className="w-36 text-right">Counted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => {
                  const system = onHand(item, locationId);
                  const raw = counts[item.id] ?? "";
                  const counted = parseInt(raw, 10);
                  const hasCount = raw.trim() !== "";
                  const invalid =
                    hasCount && (!Number.isFinite(counted) || counted < 0);
                  const drift =
                    hasCount && !invalid ? counted - system : null;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.sku}
                          {item.category?.name ? ` · ${item.category.name}` : ""}
                          {" · per "}
                          {item.unit}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {system}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {drift !== null && drift !== 0 && (
                            <span
                              className={cn(
                                "text-xs font-semibold tabular-nums",
                                drift > 0 ? "text-success" : "text-destructive"
                              )}
                            >
                              {drift > 0 ? `+${drift}` : drift}
                            </span>
                          )}
                          <Input
                            type="number"
                            min={0}
                            value={raw}
                            onChange={(e) =>
                              setCounts((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            placeholder="skip"
                            className={cn(
                              "w-24 text-right tabular-nums",
                              invalid && "border-destructive"
                            )}
                            aria-label={`Counted quantity for ${item.name}`}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-lg sm:flex-row sm:items-center">
            <span className="shrink-0 text-sm">
              <span className="font-semibold tabular-nums">
                {countedEntries.length}
              </span>{" "}
              <span className="text-muted-foreground">
                of {items.length} items counted at {locationName}
              </span>
            </span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note, e.g. 'Stocktake 2026-07-31'"
              className="sm:ml-auto sm:max-w-xs"
              aria-label="Stocktake note"
            />
            <Button
              onClick={submit}
              loading={submitting}
              disabled={countedEntries.length === 0}
              className="shrink-0"
            >
              <ClipboardCheck /> Submit counts
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
