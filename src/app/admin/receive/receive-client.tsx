"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Search, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { receiveStock } from "@/lib/actions/inventory";
import { friendlyError } from "@/lib/utils";
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

interface Line {
  item_id: string;
  qty: string; // raw input value; parsed on submit
}

export function ReceiveClient({
  locations,
  items,
}: {
  locations: Location[];
  items: StockItemOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [note, setNote] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const itemById = React.useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items]
  );

  const q = query.trim().toLowerCase();
  const results = q
    ? items
        .filter(
          (i) =>
            i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
        )
        .slice(0, 8)
    : [];

  function addLine(itemId: string) {
    setLines((prev) => {
      const existing = prev.find((l) => l.item_id === itemId);
      if (existing) {
        // Same item scanned twice — bump the quantity instead of duplicating.
        return prev.map((l) =>
          l.item_id === itemId
            ? { ...l, qty: String((parseInt(l.qty, 10) || 0) + 1) }
            : l
        );
      }
      return [...prev, { item_id: itemId, qty: "1" }];
    });
    setQuery("");
    setOpen(false);
  }

  function setQty(itemId: string, qty: string) {
    setLines((prev) =>
      prev.map((l) => (l.item_id === itemId ? { ...l, qty } : l))
    );
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.item_id !== itemId));
  }

  const locationName =
    locations.find((l) => l.id === locationId)?.name ?? "location";

  const parsedLines = lines.map((l) => ({
    item_id: l.item_id,
    qty: parseInt(l.qty, 10),
  }));
  const allValid =
    parsedLines.length > 0 &&
    parsedLines.every((l) => Number.isFinite(l.qty) && l.qty > 0);

  async function submit() {
    if (!locationId || !allValid) return;
    setSubmitting(true);
    const res = await receiveStock(
      locationId,
      parsedLines,
      note.trim() || undefined
    );
    setSubmitting(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(
      `Received ${res.data} line${res.data === 1 ? "" : "s"} into ${locationName}.`
    );
    setLines([]);
    setNote("");
    router.refresh();
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4 text-muted-foreground" />
            Delivery details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="receive-location">Receiving into</Label>
              <Select
                id="receive-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receive-note">Note (supplier / invoice)</Label>
              <Input
                id="receive-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Popular Book Co, Inv #4821"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="receive-search">Add items</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="receive-search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results[0]) {
                    e.preventDefault();
                    addLine(results[0].id);
                  }
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Search by name or SKU, then click to add a line…"
                className="pl-9"
                autoComplete="off"
              />
              {open && q && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-card shadow-md">
                  {results.length === 0 ? (
                    <li className="px-3 py-2.5 text-sm text-muted-foreground">
                      No items match &quot;{query.trim()}&quot;.
                    </li>
                  ) : (
                    results.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addLine(item.id)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {item.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {item.sku}
                              {item.category?.name
                                ? ` · ${item.category.name}`
                                : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {onHand(item, locationId)} {item.unit} on hand
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {lines.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="No lines yet"
          description="Search above and click an item to add it — one line per item on the delivery."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="w-32 text-right">Qty received</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const item = itemById.get(line.item_id);
              if (!item) return null;
              const qty = parseInt(line.qty, 10);
              const invalid = !Number.isFinite(qty) || qty <= 0;
              return (
                <TableRow key={line.item_id}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.sku} · per {item.unit}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {onHand(item, locationId)} {item.unit}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={(e) => setQty(line.item_id, e.target.value)}
                      className={`ml-auto w-24 text-right tabular-nums ${
                        invalid ? "border-destructive" : ""
                      }`}
                      aria-label={`Quantity received for ${item.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(line.item_id)}
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center justify-end gap-3">
        {lines.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {lines.length} line{lines.length === 1 ? "" : "s"} →{" "}
            <span className="font-medium text-foreground">{locationName}</span>
          </span>
        )}
        <Button
          onClick={submit}
          loading={submitting}
          disabled={!locationId || !allValid}
        >
          <Truck /> Confirm receipt
        </Button>
      </div>
    </div>
  );
}
