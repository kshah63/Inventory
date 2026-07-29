"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { BasketDisplayLine } from "./basket";

/** Basket review before checkout: confirm lines and answer "which department
 * is this for?" (the list is configurable in Admin → Settings). */
export function ReviewSheet({
  open,
  lines,
  zones,
  busy,
  onRemove,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  lines: BasketDisplayLine[];
  zones: string[];
  busy: boolean;
  onRemove: (itemId: string) => void;
  onCancel: () => void;
  onConfirm: (zone: string | null) => void;
}) {
  const [zone, setZone] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setZone(null);
  }, [open]);

  const total = lines.reduce((n, l) => n + l.qty, 0);
  const needsZone = zones.length > 0;
  const canConfirm = lines.length > 0 && (!needsZone || zone !== null) && !busy;

  return (
    <Dialog open={open} onClose={busy ? () => {} : onCancel} className="max-w-xl">
      <DialogTitle className="text-2xl">Review your basket</DialogTitle>
      <DialogDescription className="text-base">
        Check the list, pick the zone, and you&apos;re done.
      </DialogDescription>

      <ul className="divide-y rounded-lg border">
        {lines.map((line) => (
          <li key={line.item_id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-14 shrink-0 text-lg font-bold tabular-nums">
              {line.qty} ×
            </span>
            <span className="min-w-0 flex-1 truncate text-base">{line.name}</span>
            <span className="shrink-0 text-sm text-muted-foreground">{line.unit}</span>
            <button
              type="button"
              onClick={() => onRemove(line.item_id)}
              disabled={busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${line.name}`}
            >
              <X className="h-5 w-5" />
            </button>
          </li>
        ))}
        {lines.length === 0 && (
          <li className="px-4 py-6 text-center text-muted-foreground">
            Basket is empty.
          </li>
        )}
      </ul>

      {needsZone && (
        <div className="mt-5">
          <p className="mb-2 text-base font-medium">Which department is this for?</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {zones.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZone(zone === z ? null : z)}
                disabled={busy}
                aria-pressed={zone === z}
                className={cn(
                  "h-12 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  zone === z
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent"
                )}
              >
                {z}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <Button type="button" variant="outline" size="xl" onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <Button
          type="button"
          size="xl"
          className="flex-1"
          disabled={!canConfirm}
          loading={busy}
          onClick={() => onConfirm(zone)}
        >
          <Check /> Take {total} {total === 1 ? "item" : "items"}
        </Button>
      </div>
      {needsZone && zone === null && lines.length > 0 && (
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Pick a department to continue.
        </p>
      )}
    </Dialog>
  );
}
