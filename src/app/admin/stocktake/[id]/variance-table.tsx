"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface StocktakeLineRow {
  stocktake_id: string;
  item_id: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  items: { sku: string; name: string; unit: string } | null;
}

export function VarianceTable({ lines }: { lines: StocktakeLineRow[] }) {
  const [onlyVariance, setOnlyVariance] = React.useState(false);

  const visible = onlyVariance ? lines.filter((l) => l.variance !== 0) : lines;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <label
          htmlFor="only-variance"
          className="cursor-pointer text-sm text-muted-foreground"
        >
          Only show variances
        </label>
        <Switch
          id="only-variance"
          checked={onlyVariance}
          onCheckedChange={setOnlyVariance}
          aria-label="Only show variances"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={onlyVariance ? "No variances" : "No lines counted"}
          description={
            onlyVariance
              ? "Every counted item matched the system quantity — a clean count."
              : "This stocktake has no counted lines."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">System qty</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((line) => (
              <TableRow key={line.item_id}>
                <TableCell>
                  <div className="font-medium">
                    {line.items?.name ?? "Unknown item"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {line.items?.sku ?? ""}
                    {line.items?.unit ? ` · per ${line.items.unit}` : ""}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {line.system_qty}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.counted_qty}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    line.variance > 0 && "text-success",
                    line.variance < 0 && "text-destructive",
                    line.variance === 0 && "font-normal text-muted-foreground"
                  )}
                >
                  {line.variance > 0 ? `+${line.variance}` : line.variance}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
