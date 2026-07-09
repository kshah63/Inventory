"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BasketDisplayLine {
  item_id: string;
  qty: number;
  name: string;
  unit: string;
}

/** Bottom strip pinned to the viewport while the basket is non-empty. */
export function BasketBar({
  lines,
  onRemove,
  onDone,
  busy,
}: {
  lines: BasketDisplayLine[];
  onRemove: (itemId: string) => void;
  onDone: () => void;
  busy: boolean;
}) {
  const total = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center gap-4">
        <div className="flex flex-1 items-center gap-2 overflow-x-auto py-1">
          {lines.map((line) => (
            <span
              key={line.item_id}
              className="flex shrink-0 items-center gap-2 rounded-full border bg-muted py-1.5 pl-4 pr-1.5 text-base"
            >
              <span className="font-semibold tabular-nums">{line.qty} ×</span>
              <span className="max-w-[10rem] truncate">{line.name}</span>
              <button
                type="button"
                onClick={() => onRemove(line.item_id)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${line.name}`}
              >
                <X className="h-5 w-5" />
              </button>
            </span>
          ))}
        </div>
        <Button type="button" size="xl" className="shrink-0" onClick={onDone} loading={busy}>
          <Check /> Done · {total} {total === 1 ? "item" : "items"}
        </Button>
      </div>
    </div>
  );
}
