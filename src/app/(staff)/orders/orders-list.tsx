"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, PackageOpen, Pencil, Plus, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { cancelOrder, editOrder, markOrderCollected } from "@/lib/actions/orders";
import { cn, formatDateTime, friendlyError, timeAgo } from "@/lib/utils";
import type { OrderRow, OrderStatus } from "@/lib/types";

export interface StaffOrder extends OrderRow {
  locations: { name: string } | null;
  order_lines: {
    item_id: string;
    qty_requested: number;
    qty_packed: number | null;
    items: { name: string; unit: string } | null;
  }[];
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Being prepared",
  ready: "Ready to collect",
  collected: "Collected",
  rejected: "Declined",
  cancelled: "Cancelled",
};

const STATUS_BADGE: Record<
  OrderStatus,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  pending: "warning",
  ready: "success",
  collected: "secondary",
  rejected: "destructive",
  cancelled: "outline",
};

export function OrdersList({
  orders,
  updatedIds = [],
}: {
  orders: StaffOrder[];
  /** Orders that moved on since this person last looked. */
  updatedIds?: string[];
}) {
  const updated = React.useMemo(() => new Set(updatedIds), [updatedIds]);
  const router = useRouter();
  const { toast } = useToast();
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [collecting, setCollecting] = React.useState<string | null>(null);
  // Order being edited → the quantities as they're being changed.
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, number>>({});
  const [savingEdit, setSavingEdit] = React.useState(false);

  function startEdit(order: StaffOrder) {
    setEditing(order.id);
    setDraft(
      Object.fromEntries(order.order_lines.map((l) => [l.item_id, l.qty_requested]))
    );
  }

  async function saveEdit(order: StaffOrder) {
    const lines = Object.entries(draft)
      .filter(([, qty]) => qty > 0)
      .map(([item_id, qty]) => ({ item_id, qty }));
    if (lines.length === 0) {
      toast("Remove every item and it's a cancellation — use Cancel order.", "error");
      return;
    }
    setSavingEdit(true);
    const result = await editOrder({ orderId: order.id, lines });
    setSavingEdit(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Order updated.");
    setEditing(null);
    router.refresh();
  }

  async function collect(id: string) {
    setCollecting(id);
    const result = await markOrderCollected(id);
    setCollecting(null);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Marked as collected — thanks.");
    router.refresh();
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Order supplies from the Catalogue and they'll show up here."
      >
        <Link href="/browse" className={buttonVariants({})}>
          Browse the catalogue
        </Link>
      </EmptyState>
    );
  }

  async function cancel(id: string) {
    setCancelling(id);
    const result = await cancelOrder(id);
    setCancelling(null);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Order cancelled.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => {
        const packed = order.status !== "pending" && order.status !== "cancelled";
        const isNew = updated.has(order.id);
        return (
          <div
            key={order.id}
            className={cn(
              "rounded-lg border bg-card p-4 shadow-sm",
              isNew && "border-primary/50 ring-1 ring-primary/20"
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Order #{order.order_no}</span>
              {isNew && <Badge>Updated</Badge>}
              <Badge variant={STATUS_BADGE[order.status]}>
                {STATUS_LABEL[order.status]}
              </Badge>
              {order.zone && <Badge variant="outline">{order.zone}</Badge>}
              <span className="ml-auto text-xs text-muted-foreground" title={formatDateTime(order.created_at)}>
                {timeAgo(order.created_at)}
              </span>
            </div>

            {order.status === "ready" && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-success">
                <PackageOpen className="h-4 w-4" />
                Packed — collect from {order.locations?.name ?? "the store room"}.
              </p>
            )}

            <ul className="mt-3 space-y-1 text-sm">
              {order.order_lines.map((line) => {
                if (editing === order.id) {
                  const qty = draft[line.item_id] ?? 0;
                  return (
                    <li key={line.item_id} className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="One fewer"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              [line.item_id]: Math.max(0, qty - 1),
                            }))
                          }
                        >
                          <Minus />
                        </Button>
                        <span className="w-8 text-center font-semibold tabular-nums">
                          {qty}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="One more"
                          onClick={() =>
                            setDraft((d) => ({ ...d, [line.item_id]: qty + 1 }))
                          }
                        >
                          <Plus />
                        </Button>
                      </div>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          qty === 0 && "text-muted-foreground line-through"
                        )}
                      >
                        {line.items?.name ?? "Item"}
                      </span>
                    </li>
                  );
                }
                const short =
                  packed &&
                  line.qty_packed !== null &&
                  line.qty_packed < line.qty_requested;
                return (
                  <li key={line.item_id} className="flex items-baseline gap-2">
                    <span className="w-12 shrink-0 font-semibold tabular-nums">
                      {packed && line.qty_packed !== null ? line.qty_packed : line.qty_requested}×
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {line.items?.name ?? "Item"}
                    </span>
                    {short && (
                      <span className="text-xs text-warning">
                        {line.qty_packed === 0
                          ? "not available"
                          : `only ${line.qty_packed} of ${line.qty_requested}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {order.note && (
              <p className="mt-2 text-xs text-muted-foreground">Your note: {order.note}</p>
            )}
            {order.admin_note && (
              <p className="mt-1 text-xs text-muted-foreground">
                Procurement: {order.admin_note}
              </p>
            )}

            {order.status === "pending" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {editing === order.id ? (
                  <>
                    <Button
                      size="sm"
                      loading={savingEdit}
                      onClick={() => saveEdit(order)}
                    >
                      <Check /> Save changes
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={savingEdit}
                      onClick={() => setEditing(null)}
                    >
                      <X /> Discard
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={() => startEdit(order)}>
                      <Pencil /> Change quantities
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={cancelling === order.id}
                      onClick={() => cancel(order.id)}
                    >
                      Cancel order
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* The person picking it up is the one who knows it happened. */}
            {order.status === "ready" && (
              <div className="mt-3">
                <Button
                  size="sm"
                  loading={collecting === order.id}
                  onClick={() => collect(order.id)}
                >
                  <Check /> I&apos;ve collected this
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
