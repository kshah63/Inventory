"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, TRANSACTION_TYPE_LABELS } from "@/lib/utils";
import type { TransactionRow } from "@/lib/types";

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Downloads the currently visible page of the ledger as a CSV file. */
export function ExportCsvButton({ rows, page }: { rows: TransactionRow[]; page: number }) {
  const { toast } = useToast();

  function handleExport() {
    if (rows.length === 0) return;
    const header = [
      "Timestamp (SGT)",
      "Type",
      "SKU",
      "Item",
      "Qty",
      "Unit",
      "Location",
      "User",
      "On behalf of",
      "Note",
    ];
    const lines = rows.map((t) => [
      formatDateTime(t.created_at),
      TRANSACTION_TYPE_LABELS[t.type] ?? t.type,
      t.sku,
      t.item_name,
      t.qty_delta,
      t.unit,
      t.location_name,
      t.user_name,
      t.on_behalf_of_name,
      t.note,
    ]);
    const csv = [header, ...lines].map((cols) => cols.map(csvCell).join(",")).join("\r\n");
    // BOM so Excel opens it as UTF-8.
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-page-${page + 1}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to CSV.`, "success");
  }

  return (
    <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
      <Download /> Export CSV
    </Button>
  );
}
