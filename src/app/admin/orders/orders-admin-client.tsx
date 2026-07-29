"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Inbox, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { collectOrder, packOrder, rejectOrder } from "@/lib/actions/orders";
import { formatDateTime, timeAgo } from "@/lib/utils";
import type { Location, OrderRow, OrderStatus } from "@/lib/types";

export interface AdminOrder extends OrderRow {
  locations: { name: string } | null;
  requester: { full_name: string } | null;
  packer: { full_name: string } | null;
  order_lines: {
    item_id: string;
    qty_requested: number;
    qty_packed: number | null;
    items: {
      name: string;
      unit: string;
      stock_levels: { location_id: string; qty_on_hand: number }[];
    } | null;
  }[];
}

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

type Tab = "pending" | "ready" | "done";

export function OrdersAdminClient({
  orders,
  locations,
}: {
  orders: AdminOrder[];
  locations: Location[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<Tab>("pending");
  const [packing, setPacking] = React.useState<AdminOrder | null>(null);
  const [rejecting, setRejecting] = React.useState<AdminOrder | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const pending = orders.filter((o) => o.status === "pending");
  const ready = orders.filter((o) => o.status === "ready");
  const done = orders.filter((o) => !["pending", "ready"].includes(o.status));
  const visible = tab === "pending" ? pending : tab === "ready" ? ready : done;

  async function markCollected(order: AdminOrder) {
    setBusyId(order.id);
    const result = await collectOrder(order.id);
    setBusyId(null);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`Order #${order.order_no} handed over.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="pending">To pack ({pending.length})</TabsTrigger>
          <TabsTrigger value="ready">Awaiting collection ({ready.length})</TabsTrigger>
          <TabsTrigger value="done">History ({done.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <EmptyState
          icon={tab === "pending" ? Inbox : PackageCheck}
          title={
            tab === "pending"
              ? "Nothing to pack"
              : tab === "ready"
                ? "Nothing awaiting collection"
                : "No past orders yet"
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((order) => (
            <div key={order.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">#{order.order_no}</span>
                <span>{order.requester?.full_name ?? "Staff member"}</span>
                <Badge variant={STATUS_BADGE[order.status]}>{order.status}</Badge>
                {order.zone && <Badge variant="outline">{order.zone}</Badge>}
                <span className="text-sm text-muted-foreground">
                  collect from {order.locations?.name ?? "—"}
                </span>
                <span
                  className="ml-auto text-xs text-muted-foreground"
                  title={formatDateTime(order.created_at)}
                >
                  {timeAgo(order.created_at)}
                </span>
              </div>

              <ul className="mt-2 space-y-0.5 text-sm">
                {order.order_lines.map((line) => (
                  <li key={line.item_id} className="flex items-baseline gap-2">
                    <span className="w-14 shrink-0 font-semibold tabular-nums">
                      {order.status === "pending" || line.qty_packed === null
                        ? `${line.qty_requested}×`
                        : `${line.qty_packed}×`}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {line.items?.name ?? "Item"}
                    </span>
                    {order.status !== "pending" &&
                      line.qty_packed !== null &&
                      line.qty_packed < line.qty_requested && (
                        <span className="text-xs text-warning">
                          requested {line.qty_requested}
                        </span>
                      )}
                  </li>
                ))}
              </ul>

              {order.note && (
                <p className="mt-2 text-xs text-muted-foreground">Note: {order.note}</p>
              )}
              {order.admin_note && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Packing note: {order.admin_note}
                </p>
              )}
              {order.packer && order.status !== "pending" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Packed by {order.packer.full_name}
                </p>
              )}

              {order.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => setPacking(order)}>
                    <PackageCheck /> Pack order
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setRejecting(order)}
                  >
                    Decline
                  </Button>
                </div>
              )}
              {order.status === "ready" && (
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="success"
                    loading={busyId === order.id}
                    onClick={() => markCollected(order)}
                  >
                    <Check /> Mark collected
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {packing && (
        <PackDialog
          order={packing}
          locations={locations}
          onClose={() => setPacking(null)}
        />
      )}
      {rejecting && (
        <RejectDialog order={rejecting} onClose={() => setRejecting(null)} />
      )}
    </div>
  );
}

function PackDialog({
  order,
  locations,
  onClose,
}: {
  order: AdminOrder;
  locations: Location[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [locationId, setLocationId] = React.useState(order.location_id);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [qtys, setQtys] = React.useState<Record<string, number>>(
    Object.fromEntries(order.order_lines.map((l) => [l.item_id, l.qty_requested]))
  );

  const stockAt = (line: AdminOrder["order_lines"][number]) =>
    line.items?.stock_levels.find((sl) => sl.location_id === locationId)?.qty_on_hand ?? 0;

  const total = Object.values(qtys).reduce((n, q) => n + (q || 0), 0);

  async function submit() {
    setBusy(true);
    const result = await packOrder({
      orderId: order.id,
      locationId,
      lines: Object.entries(qtys).map(([item_id, qty]) => ({ item_id, qty: qty || 0 })),
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`Order #${order.order_no} packed — requester notified.`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onClose={busy ? () => {} : onClose} className="max-w-xl">
      <DialogTitle>
        Pack order #{order.order_no} — {order.requester?.full_name}
      </DialogTitle>
      <DialogDescription>
        Adjust quantities if stock ran short (0 = not packed). Confirming
        records the checkout against the requester and notifies them.
      </DialogDescription>

      <div className="mb-3 space-y-1.5">
        <Label htmlFor="pack-room">Packing from</Label>
        <Select
          id="pack-room"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <ul className="divide-y rounded-lg border">
        {order.order_lines.map((line) => {
          const available = stockAt(line);
          const value = qtys[line.item_id] ?? 0;
          return (
            <li key={line.item_id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.items?.name}</p>
                <p className="text-xs text-muted-foreground">
                  requested {line.qty_requested} · {available} in stock here
                </p>
              </div>
              <Input
                type="number"
                min={0}
                max={available}
                value={value}
                onChange={(e) =>
                  setQtys((prev) => ({
                    ...prev,
                    [line.item_id]: Math.max(
                      0,
                      Math.min(available, Number(e.target.value) || 0)
                    ),
                  }))
                }
                className={
                  "w-20 text-center " + (value > available ? "border-destructive" : "")
                }
                aria-label={`Packed quantity for ${line.items?.name}`}
              />
            </li>
          );
        })}
      </ul>

      <div className="mt-3 space-y-1.5">
        <Label htmlFor="pack-note">
          Note to requester <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="pack-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. blue pens short — 8 of 12 packed"
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} loading={busy} disabled={total === 0}>
          <PackageCheck /> Mark ready · {total} units
        </Button>
      </DialogFooter>
      {total === 0 && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Nothing packed — set at least one quantity, or decline the order.
        </p>
      )}
    </Dialog>
  );
}

function RejectDialog({ order, onClose }: { order: AdminOrder; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    const result = await rejectOrder(order.id, note.trim() || undefined);
    setBusy(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`Order #${order.order_no} declined.`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onClose={busy ? () => {} : onClose} className="max-w-md">
      <DialogTitle>Decline order #{order.order_no}?</DialogTitle>
      <DialogDescription>
        No stock moves; the requester is notified with your note.
      </DialogDescription>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason (optional)"
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={submit} loading={busy}>
          Decline order
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
