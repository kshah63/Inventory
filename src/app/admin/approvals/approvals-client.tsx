"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Package, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { decidePendingCheckout } from "@/lib/actions/requests";
import { formatDateTime, friendlyError, timeAgo } from "@/lib/utils";
import type { PendingStatus } from "@/lib/types";

export interface ApprovalRow {
  id: string;
  qty: number;
  status: PendingStatus;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  item_name: string;
  unit: string;
  photo_url: string | null;
  location_name: string;
  requester_name: string;
  decider_name: string | null;
}

const HISTORY_BADGE: Record<PendingStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
};

/** The RPC raises 'Only N left of "…" at …' / '… 0 left of "…" at …' when
 * stock ran out between the request and the decision. */
function isInsufficientStock(message: string): boolean {
  return /left of/i.test(message);
}

export function ApprovalsClient({ rows }: { rows: ApprovalRow[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  const [decidingId, setDecidingId] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ApprovalRow | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");

  async function approve(row: ApprovalRow) {
    setDecidingId(row.id);
    const result = await decidePendingCheckout(row.id, true);
    setDecidingId(null);
    if (!result.ok) {
      const message = friendlyError(result.error);
      toast(
        isInsufficientStock(message)
          ? `${message} Receive stock first, then approve.`
          : message,
        "error"
      );
      router.refresh();
      return;
    }
    toast(
      `Approved — ${row.qty} × ${row.item_name} checked out to ${row.requester_name}.`
    );
    router.refresh();
  }

  function openReject(row: ApprovalRow) {
    setRejecting(row);
    setRejectNote("");
  }

  function closeReject() {
    if (decidingId) return;
    setRejecting(null);
  }

  async function confirmReject() {
    if (!rejecting) return;
    setDecidingId(rejecting.id);
    const result = await decidePendingCheckout(rejecting.id, false, rejectNote);
    setDecidingId(null);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast(`Rejected ${rejecting.qty} × ${rejecting.item_name}. ${rejecting.requester_name} has been notified.`);
    setRejecting(null);
    router.refresh();
  }

  return (
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">
          Pending
          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {pending.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>

      <TabsContent value="pending">
        {pending.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No approvals waiting"
            description="When staff check out an approval-required item, it lands here for a one-tap decision."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((row) => (
              <Card key={row.id}>
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {row.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.photo_url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Package className="h-6 w-6 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">
                      {row.qty} × {row.item_name}{" "}
                      <span className="font-normal text-muted-foreground">
                        {row.unit}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {row.requester_name} · {row.location_name} ·{" "}
                      {timeAgo(row.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="success"
                      onClick={() => approve(row)}
                      loading={decidingId === row.id}
                      disabled={decidingId !== null && decidingId !== row.id}
                    >
                      <Check /> Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => openReject(row)}
                      disabled={decidingId !== null}
                    >
                      <X /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">
              Approving records the checkout against the requester and notifies them.
            </p>
          </div>
        )}
      </TabsContent>

      <TabsContent value="history">
        {history.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No decisions yet"
            description="Approved and rejected checkouts will appear here with who decided them."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Decision</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Decided by</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Decided at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant={HISTORY_BADGE[row.status]} className="capitalize">
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">
                      {row.qty} × {row.item_name}
                    </span>{" "}
                    <span className="text-muted-foreground">{row.unit}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.requester_name}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.location_name}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.decider_name ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    {row.decision_note ? (
                      <span className="text-muted-foreground">{row.decision_note}</span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.decided_at ? formatDateTime(row.decided_at) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <Dialog open={rejecting !== null} onClose={closeReject} className="max-w-md">
        {rejecting && (
          <>
            <DialogTitle>
              Reject {rejecting.qty} × {rejecting.item_name}?
            </DialogTitle>
            <DialogDescription>
              {rejecting.requester_name} sees the decision on their own screen.
              No stock is deducted.
            </DialogDescription>
            <div className="space-y-1.5">
              <Label htmlFor="reject-note">Reason (optional)</Label>
              <Textarea
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="e.g. Reserved for the holiday programme — ask again next week"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={closeReject}
                disabled={decidingId !== null}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmReject}
                loading={decidingId === rejecting.id}
              >
                Reject request
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </Tabs>
  );
}
