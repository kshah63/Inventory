"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ArrowRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { transferStock } from "@/lib/actions/inventory";
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

export function TransferClient({
  locations,
  items,
}: {
  locations: Location[];
  items: StockItemOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [itemId, setItemId] = React.useState<string | null>(null);
  const [fromId, setFromId] = React.useState(locations[0]?.id ?? "");
  const [toId, setToId] = React.useState(locations[1]?.id ?? "");
  const [qtyRaw, setQtyRaw] = React.useState("1");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const item = itemId ? (items.find((i) => i.id === itemId) ?? null) : null;
  const sourceQty = item && fromId ? onHand(item, fromId) : 0;
  const destQty = item && toId ? onHand(item, toId) : 0;
  const qty = parseInt(qtyRaw, 10);
  const qtyValid = Number.isFinite(qty) && qty > 0 && qty <= sourceQty;
  const sameLocation = fromId !== "" && fromId === toId;

  const canSubmit =
    !!item && !!fromId && !!toId && !sameLocation && qtyValid;

  const fromName = locations.find((l) => l.id === fromId)?.name ?? "";
  const toName = locations.find((l) => l.id === toId)?.name ?? "";

  async function submit() {
    if (!canSubmit || !item) return;
    setSubmitting(true);
    const res = await transferStock({
      itemId: item.id,
      fromLocation: fromId,
      toLocation: toId,
      qty,
      note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(`Transferred ${qty} ${item.unit} of ${item.name}: ${fromName} → ${toName}.`);
    setQtyRaw("1");
    setNote("");
    router.refresh();
  }

  if (locations.length < 2) {
    return (
      <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        Transfers need at least two active locations. Add another location in
        Settings first.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
            Movement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <ItemCombobox items={items} value={itemId} onChange={setItemId} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-from">From</Label>
              <Select
                id="transfer-from"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-to">To</Label>
              <Select
                id="transfer-to"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id} disabled={l.id === fromId}>
                    {l.name}
                    {l.id === fromId ? " (source)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {sameLocation && (
            <p className="text-sm text-destructive">
              Source and destination must differ.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="transfer-qty">Quantity</Label>
            <div className="flex items-center gap-3">
              <Input
                id="transfer-qty"
                type="number"
                min={1}
                max={sourceQty || undefined}
                value={qtyRaw}
                onChange={(e) => setQtyRaw(e.target.value)}
                className="w-32 text-right tabular-nums"
                disabled={!item}
              />
              {item && (
                <span
                  className={cn(
                    "text-sm",
                    sourceQty === 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {sourceQty} {item.unit} available at {fromName}
                </span>
              )}
            </div>
            {item && Number.isFinite(qty) && qty > sourceQty && (
              <p className="text-sm text-destructive">
                Can&apos;t transfer more than the {sourceQty} on hand at{" "}
                {fromName}.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-note">Note (optional)</Label>
            <Input
              id="transfer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Restocking Room 2 for the holiday programme"
            />
          </div>
        </CardContent>
      </Card>

      {item && !sameLocation && (
        <div className="grid gap-3 sm:grid-cols-2">
          <PreviewCard
            title={`From ${fromName}`}
            before={sourceQty}
            after={qtyValid ? sourceQty - qty : null}
            unit={item.unit}
          />
          <PreviewCard
            title={`To ${toName}`}
            before={destQty}
            after={qtyValid ? destQty + qty : null}
            unit={item.unit}
          />
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
          <ArrowLeftRight /> Transfer
        </Button>
      </div>
    </div>
  );
}

function PreviewCard({
  title,
  before,
  after,
  unit,
}: {
  title: string;
  before: number;
  after: number | null;
  unit: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 flex items-baseline gap-2 text-lg font-semibold tabular-nums">
        {before}
        {after !== null && (
          <>
            <ArrowRight className="h-4 w-4 self-center text-muted-foreground" />
            <span className={cn(after < before ? "text-warning" : "text-success")}>
              {after}
            </span>
          </>
        )}
        <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </p>
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
