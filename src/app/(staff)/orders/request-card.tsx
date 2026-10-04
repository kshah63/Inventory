"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ExternalLink, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelOwnRequest, markRequestCollected } from "@/lib/actions/requests";
import { RequestEditDialog } from "./request-edit-dialog";
import { Timeline, type TimelineStep } from "@/components/ui/timeline";
import {
  formatDate,
  formatDateTime,
  friendlyError,
  timeAgo,
  REQUEST_STATUS_LABELS_REQUESTER,
} from "@/lib/utils";
import type { RequestRow, RequestStatus } from "@/lib/types";

export interface RequestWithJoins extends RequestRow {
  items: { name: string; unit: string } | null;
}

/** A bought-in request's lifecycle, from the requester's point of view — the
 * internal "received" stage is folded into "On order", never shown as such. */
function requestSteps(r: RequestWithJoins): TimelineStep[] {
  if (r.status === "rejected") {
    return [
      { label: "Requested", at: r.created_at, state: "done" },
      { label: "Declined", at: r.updated_at, state: "cancelled" },
    ];
  }
  const onOrder =
    r.status === "acknowledged" || r.status === "ordered" || r.status === "received";
  const ready = r.status === "ready";
  const done = r.status === "fulfilled";
  return [
    { label: "Requested", at: r.created_at, state: r.status === "open" ? "current" : "done" },
    {
      label: "On order",
      at: r.expected_date,
      state: onOrder ? "current" : ready || done ? "done" : "todo",
    },
    { label: "Ready to collect", state: ready ? "current" : done ? "done" : "todo" },
    { label: "Collected", at: r.collected_at, state: done ? "done" : "todo" },
  ];
}

const STATUS_VARIANT: Record<
  RequestStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  open: "warning",
  acknowledged: "secondary",
  ordered: "default",
  received: "default",
  ready: "success",
  fulfilled: "secondary",
  rejected: "destructive",
};

/** Something we don't keep on the shelf, bought in for whoever asked. */
export function RequestCard({
  request: req,
  zones = [],
}: {
  request: RequestWithJoins;
  /** Needed only when a declined request is reopened to edit and resubmit. */
  zones?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [cancelling, setCancelling] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);

  const itemLabel = req.items?.name ?? req.free_text_item ?? "Item";

  async function cancel() {
    setCancelling(true);
    const result = await cancelOwnRequest(req.id);
    setCancelling(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Request cancelled.", "success");
    router.refresh();
  }

  async function collect() {
    setCollecting(true);
    const result = await markRequestCollected(req.id);
    setCollecting(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Marked as collected — thanks.", "success");
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/* Says why this one takes longer, without making it a place to look. */}
        <Badge variant="outline" title="Not something we keep on the shelf">
          Bought in for you
        </Badge>
        <Badge variant={STATUS_VARIANT[req.status]}>
          {REQUEST_STATUS_LABELS_REQUESTER[req.status] ?? req.status}
        </Badge>
        {req.zone && <Badge variant="outline">{req.zone}</Badge>}
        <span
          className="ml-auto text-xs text-muted-foreground"
          title={formatDateTime(req.created_at)}
        >
          {timeAgo(req.created_at)}
        </span>
      </div>

      <div className="mt-3 flex items-start gap-3">
        {req.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={req.photo_url}
            alt={itemLabel}
            className="h-16 w-16 shrink-0 rounded-md border object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {req.qty} × {itemLabel}
            {req.items?.unit && (
              <span className="font-normal text-muted-foreground">
                {" "}
                ({req.items.unit})
              </span>
            )}
          </p>

          {/* What procurement expects, so nobody has to ask. */}
          {req.expected_date &&
            req.status !== "fulfilled" &&
            req.status !== "rejected" && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                {req.status === "ready"
                  ? "Ready now — come and collect it"
                  : `Expected around ${formatDate(req.expected_date)}`}
              </p>
            )}

          {req.description && (
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
              {req.description}
            </p>
          )}

          {req.product_url && (
            <a
              href={req.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">View the product</span>
            </a>
          )}
        </div>
      </div>

      {req.note && (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Your note:</span> {req.note}
        </p>
      )}

      {req.admin_note && (
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="font-medium">Procurement:</span> {req.admin_note}
        </p>
      )}

      <Timeline steps={requestSteps(req)} />

      {req.status === "open" && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            loading={cancelling}
            onClick={cancel}
          >
            <Trash2 /> Cancel request
          </Button>
        </div>
      )}

      {/* Declined — fix what procurement flagged and send it back. */}
      {req.status === "rejected" && (
        <div className="mt-3 flex justify-end">
          <RequestEditDialog request={req} zones={zones} />
        </div>
      )}

      {/* Same tick as an order — the person picking it up knows. */}
      {req.status === "ready" && (
        <div className="mt-3">
          <Button size="sm" loading={collecting} onClick={collect}>
            <Check /> I&apos;ve collected this
          </Button>
        </div>
      )}
    </div>
  );
}
