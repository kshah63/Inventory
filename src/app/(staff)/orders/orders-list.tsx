"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PackageOpen, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { cancelOrder } from "@/lib/actions/orders";
import { formatDateTime, timeAgo } from "@/lib/utils";
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

export function OrdersList({ orders }: { orders: StaffOrder[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [cancelling, setCancelling] = React.useState<string | null>(null);

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Order supplies from the Shop and they'll show up here."
      >
        <Link href="/browse" className={buttonVariants({})}>
          Go to Shop
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
        return (
          <div key={order.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Order #{order.order_no}</span>
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
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  loading={cancelling === order.id}
                  onClick={() => cancel(order.id)}
                >
                  Cancel order
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
