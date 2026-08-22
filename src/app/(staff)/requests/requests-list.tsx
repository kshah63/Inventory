"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ExternalLink, Inbox, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { cancelOwnRequest, markRequestCollected } from "@/lib/actions/requests";
import {
  formatDate,
  friendlyError,
  timeAgo,
  REQUEST_STATUS_LABELS_REQUESTER,
} from "@/lib/utils";
import type { RequestRow, RequestStatus } from "@/lib/types";

export interface RequestWithJoins extends RequestRow {
  items: { name: string; unit: string } | null;
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

export function RequestsList({ requests }: { requests: RequestWithJoins[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const [collectingId, setCollectingId] = React.useState<string | null>(null);

  async function handleCancel(id: string) {
    setCancellingId(id);
    const result = await cancelOwnRequest(id);
    setCancellingId(null);
    if (result.ok) {
      toast("Request cancelled.", "success");
      router.refresh();
    } else {
      toast(friendlyError(result.error), "error");
    }
  }

  async function handleCollect(id: string) {
    setCollectingId(id);
    const result = await markRequestCollected(id);
    setCollectingId(null);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Marked as collected — thanks.", "success");
    router.refresh();
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No requests yet"
        description="Nothing asked for so far. If we don't stock something you need, use Request a new item."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {requests.map((req) => {
        const itemLabel = req.items?.name ?? req.free_text_item ?? "Item";
        return (
          <li key={req.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-3">
              {req.photo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={req.photo_url}
                  alt={itemLabel}
                  className="h-16 w-16 shrink-0 rounded-md border object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">
                    {req.qty} × {itemLabel}
                    {req.items?.unit && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        ({req.items.unit})
                      </span>
                    )}
                  </p>
                  <Badge variant={STATUS_VARIANT[req.status]} className="shrink-0">
                    {REQUEST_STATUS_LABELS_REQUESTER[req.status] ?? req.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {req.zone ? `Zone ${req.zone} · ` : ""}
                  {timeAgo(req.created_at)}
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

            {req.status === "open" && (
              <div className="mt-3 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  loading={cancellingId === req.id}
                  onClick={() => handleCancel(req.id)}
                >
                  <Trash2 />
                  Cancel request
                </Button>
              </div>
            )}

            {/* The person picking it up is the one who knows it happened —
                the same tick an order gets. */}
            {req.status === "ready" && (
              <div className="mt-3">
                <Button
                  size="sm"
                  loading={collectingId === req.id}
                  onClick={() => handleCollect(req.id)}
                >
                  <Check /> I&apos;ve collected this
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
