"use client";

import * as React from "react";
import { Download, MessageCircle, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ReorderRow } from "@/lib/types";

const keyOf = (r: ReorderRow) => `${r.item_id}:${r.location_id}`;

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ReorderClient({ rows }: { rows: ReorderRow[] }) {
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(rows.map(keyOf))
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="Nothing needs reordering"
        description="Items appear here when on-hand stock drops to or below the reorder point. Set reorder points per item and location in Inventory."
      />
    );
  }

  const allSelected = selected.size === rows.length;
  const selectedRows = rows.filter((r) => selected.has(keyOf(r)));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map(keyOf)));
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportCsv() {
    const lines = [
      "sku,item,location,on_hand,reorder_point,par_level,suggested_qty",
      ...selectedRows.map((r) =>
        [
          csvField(r.sku),
          csvField(r.item_name),
          csvField(r.location_name),
          r.qty_on_hand,
          r.reorder_point,
          r.par_level,
          r.suggested_qty,
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mathvision-reorder-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${selectedRows.length} item${selectedRows.length === 1 ? "" : "s"} to CSV.`);
  }

  async function copyWhatsApp() {
    const text =
      "📦 MathVision order list:\n" +
      selectedRows
        .map(
          (r) =>
            `• ${r.item_name} — ${r.location_name}: ${r.qty_on_hand} left, order ${r.suggested_qty}`
        )
        .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied — paste into your supplier WhatsApp chat");
    } catch {
      toast("Couldn't copy to clipboard — check browser permissions.", "error");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {selected.size} of {rows.length} selected
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={selected.size === 0}>
            <Download /> Export CSV
          </Button>
          <Button onClick={copyWhatsApp} disabled={selected.size === 0}>
            <MessageCircle /> Copy as WhatsApp message
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Reorder pt</TableHead>
            <TableHead className="text-right" title="The level to top back up to">Top up to</TableHead>
            <TableHead className="text-right">Suggested qty</TableHead>
            <TableHead className="text-right">Daily use</TableHead>
            <TableHead className="text-right">Days left</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const key = keyOf(r);
            const isSelected = selected.has(key);
            return (
              <TableRow key={key} className={cn(!isSelected && "opacity-50")}>
                <TableCell>
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={isSelected}
                    onChange={() => toggleRow(key)}
                    aria-label={`Select ${r.item_name} at ${r.location_name}`}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.location_name}</TableCell>
                <TableCell>
                  <div className="font-medium">{r.item_name}</div>
                  <div className="text-xs text-muted-foreground">{r.sku}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.qty_on_hand === 0 ? (
                    <Badge variant="destructive">OUT</Badge>
                  ) : (
                    r.qty_on_hand
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.reorder_point}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.par_level}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {r.suggested_qty}
                  <span className="ml-1 font-normal text-muted-foreground">{r.unit}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {Number(r.avg_daily_use) > 0 ? r.avg_daily_use : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.days_to_stockout === null ? (
                    <span className="text-muted-foreground">∞</span>
                  ) : (
                    <span
                      className={cn(
                        Number(r.days_to_stockout) < 7 && "font-semibold text-destructive"
                      )}
                    >
                      {r.days_to_stockout}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
