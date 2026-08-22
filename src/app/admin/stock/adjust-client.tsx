"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { adjustStock } from "@/lib/actions/inventory";
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

export function AdjustClient({
  locations,
  items,
}: {
  locations: Location[];
  items: StockItemOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [itemId, setItemId] = React.useState<string | null>(null);
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [deltaRaw, setDeltaRaw] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const item = itemId ? (items.find((i) => i.id === itemId) ?? null) : null;
  const current = item && locationId ? onHand(item, locationId) : 0;
  const delta = parseInt(deltaRaw, 10);
  const deltaValid = Number.isFinite(delta) && delta !== 0;
  const resulting = deltaValid ? current + delta : null;
  const wouldGoNegative = resulting !== null && resulting < 0;
  const noteMissing = note.trim() === "";

  const canSubmit =
    !!item && !!locationId && deltaValid && !wouldGoNegative && !noteMissing;

  const locationName =
    locations.find((l) => l.id === locationId)?.name ?? "location";

  async function submit() {
    if (!canSubmit || !item) return;
    setSubmitting(true);
    const res = await adjustStock({
      itemId: item.id,
      locationId,
      qtyDelta: delta,
      note: note.trim(),
    });
    setSubmitting(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(
      `Adjusted ${item.name} by ${delta > 0 ? "+" : ""}${delta} ${item.unit} at ${locationName}.`
    );
    setDeltaRaw("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            Correction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <ItemCombobox items={items} value={itemId} onChange={setItemId} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="adjust-location">Location</Label>
              <Select
                id="adjust-location"
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
              <Label htmlFor="adjust-delta">Change (+/−)</Label>
              <Input
                id="adjust-delta"
                type="number"
                value={deltaRaw}
                onChange={(e) => setDeltaRaw(e.target.value)}
                placeholder="e.g. -3"
                className="text-right tabular-nums"
                disabled={!item}
              />
            </div>
          </div>

          {item && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">
                Current on hand at {locationName}:
              </span>
              <span className="font-semibold tabular-nums">
                {current} {item.unit}
              </span>
              {resulting !== null && (
                <>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      wouldGoNegative
                        ? "text-destructive"
                        : delta < 0
                          ? "text-warning"
                          : "text-success"
                    )}
                  >
                    {resulting} {item.unit}
                  </span>
                </>
              )}
            </div>
          )}
          {wouldGoNegative && (
            <p className="text-sm text-destructive">
              This would take stock below zero — check the change amount, or run
              a stocktake if the numbers are badly off.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="adjust-note">Reason (required)</Label>
            <Textarea
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Found 2 damaged in storeroom; written off"
            />
            {deltaValid && noteMissing && (
              <p className="text-xs text-muted-foreground">
                A reason note is required for every adjustment.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
          <SlidersHorizontal /> Record adjustment
        </Button>
      </div>
    </div>
  );
}

function ItemCombobox({
  items,
  value,
  onChange,
}: {
  items: StockItemOption[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const selected = value ? (items.find((i) => i.id === value) ?? null) : null;
  const q = query.trim().toLowerCase();
  const results = (
    q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
        )
      : items
  ).slice(0, 8);

  if (selected) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 shadow-sm">
        <span className="min-w-0 truncate text-sm">
          <span className="font-medium">{selected.name}</span>{" "}
          <span className="text-xs text-muted-foreground">{selected.sku}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Clear selected item"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
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
            onChange(results[0].id);
            setQuery("");
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search by name or SKU…"
        className="pl-9"
        autoComplete="off"
        aria-label="Search items"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-card shadow-md">
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              No items match &quot;{query.trim()}&quot;.
            </li>
          ) : (
            results.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(i.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.sku}
                      {i.category?.name ? ` · ${i.category.name}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
