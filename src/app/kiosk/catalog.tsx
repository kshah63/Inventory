"use client";

import * as React from "react";
import { HelpCircle, Package, PackageSearch, Search, ShieldAlert, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { BasketLine, CatalogItem, Category, Location } from "@/lib/types";
import { QtyStepper } from "./qty-stepper";

/** Quantity on hand for an item at a location (0 when no stock row exists). */
export function stockAt(item: CatalogItem, locationId: string): number {
  return item.stock_levels.find((sl) => sl.location_id === locationId)?.qty_on_hand ?? 0;
}

interface CatalogProps {
  items: CatalogItem[];
  categories: Category[];
  locations: Location[];
  locationId: string;
  basket: BasketLine[];
  onTake: (item: CatalogItem, qty: number) => void;
  onRequestApproval: (item: CatalogItem, qty: number) => Promise<boolean>;
  onRequestRestock: (item: CatalogItem, qty: number, note: string) => Promise<boolean>;
  onReturnItems: () => void;
  onCantFind: () => void;
}

export function Catalog({
  items,
  categories,
  locations,
  locationId,
  basket,
  onTake,
  onRequestApproval,
  onRequestRestock,
  onReturnItems,
  onCantFind,
}: CatalogProps) {
  const [query, setQuery] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState(1);
  const [perPack, setPerPack] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const locationNames = React.useMemo(
    () => new Map(locations.map((l) => [l.id, l.name])),
    [locations]
  );
  const basketQty = React.useMemo(
    () => new Map(basket.map((l) => [l.item_id, l.qty])),
    [basket]
  );

  const q = query.trim().toLowerCase();
  const filtered = items.filter(
    (it) =>
      (!categoryId || it.category_id === categoryId) &&
      (!q || it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q))
  );

  // Derive the selected item from live items state so realtime stock updates
  // are reflected while the dialog is open.
  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  const openItem = (item: CatalogItem) => {
    setSelectedId(item.id);
    setQty(basketQty.get(item.id) ?? 1);
    setPerPack(false);
    setNote("");
  };

  const closeDialog = () => {
    if (busy) return;
    setSelectedId(null);
  };

  // Dialog mode: no stock here → restock request; approval-gated → approval; else take.
  const here = selected ? stockAt(selected, locationId) : 0;
  const mode: "take" | "approval" | "restock" | null = !selected
    ? null
    : here === 0
      ? "restock"
      : selected.requires_approval
        ? "approval"
        : "take";
  const maxQty =
    !selected || mode === "restock"
      ? 999
      : mode === "approval"
        ? selected.max_per_checkout ?? 99
        : Math.min(here, selected.max_per_checkout ?? here);

  // Pack-aware taking (pilot feedback): items with a pack_size can be taken
  // by the pack — the stepper counts packs, stock is deducted in base units.
  const packSize = selected?.pack_size ?? null;
  const packChoiceAvailable =
    mode === "take" && packSize != null && packSize > 1 && Math.floor(maxQty / packSize) >= 1;
  const usePack = perPack && packChoiceAvailable && packSize != null;
  const effectiveMax = usePack ? Math.floor(maxQty / packSize) : maxQty;
  const clampedQty = Math.max(1, Math.min(qty, effectiveMax));
  const baseQty = usePack ? clampedQty * packSize : clampedQty;

  const alsoElsewhere = (item: CatalogItem): string | null => {
    const others = item.stock_levels
      .filter((sl) => sl.location_id !== locationId && sl.qty_on_hand > 0)
      .map((sl) => `${sl.qty_on_hand} in ${locationNames.get(sl.location_id) ?? "another room"}`);
    if (others.length === 0) return null;
    return `also ${others.slice(0, 2).join(" · ")}`;
  };

  const runAsync = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) setSelectedId(null);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      {/* Search + secondary flows */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items or SKU…"
            aria-label="Search items"
            className="h-14 pl-12 text-lg"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" className="flex-1 md:flex-none" onClick={onReturnItems}>
            <Undo2 /> Return items
          </Button>
          <Button type="button" variant="ghost" size="lg" className="flex-1 md:flex-none" onClick={onCantFind}>
            <HelpCircle /> Can&apos;t find it?
          </Button>
        </div>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <CategoryChip active={categoryId === null} onClick={() => setCategoryId(null)}>
          All
        </CategoryChip>
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            active={categoryId === c.id}
            onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
          >
            {c.name}
          </CategoryChip>
        ))}
      </div>

      {/* Item grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Nothing matches"
          description="Try a different search or category — or tap “Can't find it?” to request it."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => {
            const qtyHere = stockAt(item, locationId);
            const inBasket = basketQty.get(item.id) ?? 0;
            const also = alsoElsewhere(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                className="flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-transform hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
              >
                <div className="relative flex h-28 w-full items-center justify-center bg-muted">
                  {item.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.photo_url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Package className="h-10 w-10 text-muted-foreground/40" />
                  )}
                  {item.requires_approval && (
                    <Badge variant="warning" className="absolute left-2 top-2 gap-1">
                      <ShieldAlert className="h-3 w-3" /> Approval
                    </Badge>
                  )}
                  {inBasket > 0 && (
                    <Badge className="absolute right-2 top-2">×{inBasket} in basket</Badge>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-3">
                  <div className="line-clamp-2 text-base font-semibold leading-snug sm:text-lg">
                    {item.name}
                  </div>
                  <div className="text-xs text-muted-foreground">{item.sku}</div>
                  <div
                    className={cn(
                      "mt-1 text-xl font-bold",
                      qtyHere === 0 ? "text-destructive" : "text-success"
                    )}
                  >
                    {qtyHere === 0 ? "Out" : `${qtyHere} ${item.unit}`}
                  </div>
                  {also && <div className="text-xs text-muted-foreground">{also}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Stepper dialog */}
      <Dialog open={!!selected} onClose={closeDialog}>
        {selected && mode && (
          <>
            <DialogTitle className="text-2xl">{selected.name}</DialogTitle>
            <DialogDescription className="text-base">
              {selected.sku}
              {mode !== "restock" ? (
                <> · {here} {selected.unit} available here</>
              ) : (
                <>
                  {" · "}
                  <span className="font-medium text-destructive">out of stock here</span>
                  {alsoElsewhere(selected) ? <> — {alsoElsewhere(selected)}</> : null}
                </>
              )}
            </DialogDescription>

            <div className="py-4">
              {packChoiceAvailable && packSize != null && (
                <div className="mb-4 flex justify-center gap-2">
                  <UnitChip active={!perPack} onClick={() => setPerPack(false)}>
                    Single {selected.unit}
                  </UnitChip>
                  <UnitChip active={perPack} onClick={() => setPerPack(true)}>
                    Pack of {packSize}
                  </UnitChip>
                </div>
              )}
              <QtyStepper
                value={clampedQty}
                onChange={setQty}
                min={1}
                max={effectiveMax}
                unit={usePack ? `pack${clampedQty === 1 ? "" : "s"} of ${packSize}` : selected.unit}
              />
              {usePack && (
                <p className="mt-3 text-center text-base font-medium">
                  = {baseQty} {selected.unit} total
                </p>
              )}
              {selected.max_per_checkout != null && (
                <p className="mt-3 text-center text-sm text-muted-foreground">
                  Max {selected.max_per_checkout} {selected.unit} per checkout
                </p>
              )}
            </div>

            {mode === "restock" && (
              <div className="space-y-2">
                <Label htmlFor="restock-note" className="text-base">
                  Note <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="restock-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. needed for Saturday classes"
                  className="h-12 text-base"
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" size="xl" onClick={closeDialog} disabled={busy}>
                Cancel
              </Button>
              {mode === "take" && (
                <Button
                  type="button"
                  size="xl"
                  className="sm:flex-1"
                  onClick={() => {
                    onTake(selected, baseQty);
                    setSelectedId(null);
                  }}
                >
                  {usePack
                    ? `Take ${clampedQty} pack${clampedQty === 1 ? "" : "s"} (${baseQty} ${selected.unit})`
                    : `Take ${clampedQty} ${selected.unit}`}
                </Button>
              )}
              {mode === "approval" && (
                <Button
                  type="button"
                  size="xl"
                  className="bg-warning text-warning-foreground hover:bg-warning/90 sm:flex-1"
                  loading={busy}
                  onClick={() => void runAsync(() => onRequestApproval(selected, clampedQty))}
                >
                  <ShieldAlert /> Request approval
                </Button>
              )}
              {mode === "restock" && (
                <Button
                  type="button"
                  size="xl"
                  className="sm:flex-1"
                  loading={busy}
                  onClick={() => void runAsync(() => onRequestRestock(selected, clampedQty, note))}
                >
                  Request restock
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}

function UnitChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-12 rounded-lg border px-5 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-card hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-12 shrink-0 whitespace-nowrap rounded-full border px-5 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-card text-foreground hover:bg-accent"
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
