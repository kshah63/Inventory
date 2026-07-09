"use client";

import * as React from "react";
import { ArrowLeft, PackageSearch, Search, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { CatalogItem } from "@/lib/types";
import { QtyStepper } from "./qty-stepper";
import { stockAt } from "./catalog";

/** "I took too many" — pick an item, choose a qty, put it back on the shelf. */
export function ReturnScreen({
  items,
  locationId,
  onBack,
  onReturn,
}: {
  items: CatalogItem[];
  locationId: string;
  onBack: () => void;
  onReturn: (itemId: string, qty: number, note: string) => Promise<boolean>;
}) {
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState(1);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (it) => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)
      )
    : items;

  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  const submit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const ok = await onReturn(selected.id, qty, note);
    setBusy(false);
    if (ok) setSelectedId(null);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="lg" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Return items</h1>
      </div>
      <p className="text-lg text-muted-foreground">
        Took too many? Tap the item you&apos;re putting back.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items or SKU…"
          aria-label="Search items to return"
          className="h-14 pl-12 text-lg"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Nothing matches" description="Try another search." />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((item) => {
            const here = stockAt(item, locationId);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id);
                  setQty(1);
                  setNote("");
                }}
                className="flex min-h-16 items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left shadow-sm transition-transform hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{item.name}</span>
                  <span className="block text-sm text-muted-foreground">{item.sku}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-base font-semibold",
                    here === 0 ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {here} {item.unit} here
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onClose={() => !busy && setSelectedId(null)}>
        {selected && (
          <>
            <DialogTitle className="text-2xl">Return {selected.name}</DialogTitle>
            <DialogDescription className="text-base">
              How many {selected.unit} are you putting back?
            </DialogDescription>

            <div className="py-4">
              <QtyStepper value={qty} onChange={setQty} min={1} max={999} unit={selected.unit} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="return-note" className="text-base">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="return-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. grabbed 5 but only needed 3"
                className="h-12 text-base"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="xl"
                onClick={() => setSelectedId(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="success"
                size="xl"
                className="sm:flex-1"
                onClick={() => void submit()}
                loading={busy}
              >
                <Undo2 /> Return {qty} {selected.unit}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}
