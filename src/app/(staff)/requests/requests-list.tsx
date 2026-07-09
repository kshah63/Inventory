"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Inbox, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { cancelOwnRequest } from "@/lib/actions/requests";
import { friendlyError, timeAgo, REQUEST_STATUS_LABELS } from "@/lib/utils";
import type { RequestRow, RequestStatus } from "@/lib/types";

export interface RequestWithJoins extends RequestRow {
  items: { name: string; unit: string } | null;
  locations: { name: string } | null;
}

const STATUS_VARIANT: Record<
  RequestStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  open: "warning",
  acknowledged: "secondary",
  ordered: "default",
  fulfilled: "success",
  rejected: "destructive",
};

export function RequestsList({ requests }: { requests: RequestWithJoins[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);

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

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No requests yet"
        description='Use "New request" to ask procurement for a restock or a new item.'
      />
    );
  }

  return (
    <ul className="space-y-3">
      {requests.map((req) => {
        const itemLabel = req.items?.name ?? req.free_text_item ?? "Item";
        return (
          <li key={req.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {req.qty} × {itemLabel}
                  {req.items?.unit && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      ({req.items.unit})
                    </span>
                  )}
                  {!req.items && req.free_text_item && (
                    <span className="font-normal text-muted-foreground"> (new item)</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  For {req.locations?.name ?? "—"} · {timeAgo(req.created_at)}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[req.status]} className="shrink-0">
                {REQUEST_STATUS_LABELS[req.status] ?? req.status}
              </Badge>
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
          </li>
        );
      })}
    </ul>
  );
}
