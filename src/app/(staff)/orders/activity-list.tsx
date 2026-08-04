import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatTime, TRANSACTION_TYPE_LABELS } from "@/lib/utils";
import type { TransactionRow } from "@/lib/types";

function badgeVariant(type: TransactionRow["type"]) {
  if (type === "checkout") return "default" as const;
  if (type === "return") return "success" as const;
  return "secondary" as const;
}

function qtyLabel(row: TransactionRow) {
  const abs = Math.abs(row.qty_delta);
  if (row.type === "checkout") return `took ${abs}`;
  if (row.type === "return") return `returned ${abs}`;
  return row.qty_delta > 0 ? `+${row.qty_delta}` : `${row.qty_delta}`;
}

/** What actually reached this person, day by day — the ledger's own record,
 * as opposed to the orders that produced it. */
export function ActivityList({ rows }: { rows: TransactionRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Nothing collected yet"
        description="Once procurement packs an order for you, the items show up here."
      />
    );
  }

  // Group by calendar day (rows arrive newest-first, Map keeps that order).
  const groups = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const day = formatDate(row.created_at);
    const list = groups.get(day);
    if (list) list.push(row);
    else groups.set(day, [row]);
  }
  const today = formatDate(new Date().toISOString());

  return (
    <div className="space-y-8">
      {[...groups.entries()].map(([day, dayRows]) => (
        <section key={day}>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            {day === today ? "Today" : day}
          </h2>
          <ul className="divide-y rounded-lg border bg-card shadow-sm">
            {dayRows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 p-4">
                <Badge variant={badgeVariant(row.type)} className="mt-0.5 shrink-0">
                  {TRANSACTION_TYPE_LABELS[row.type] ?? row.type}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{qtyLabel(row)}</span>{" "}
                    <span className="text-muted-foreground">×</span>{" "}
                    <span className="font-medium">{row.item_name}</span>{" "}
                    <span className="text-muted-foreground">
                      ({row.unit}) · {row.location_name}
                    </span>
                  </p>
                  {row.note && (
                    <p className="mt-0.5 truncate text-xs italic text-muted-foreground">
                      {row.note}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatTime(row.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
