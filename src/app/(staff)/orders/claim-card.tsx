"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelClaim, receiptUrl } from "@/lib/actions/claims";
import {
  formatDateTime,
  formatMoney,
  friendlyError,
  timeAgo,
} from "@/lib/utils";
import type { ClaimStatus, ClaimWithLines } from "@/lib/types";

const STATUS_LABEL: Record<ClaimStatus, string> = {
  requested: "Awaiting payment",
  paid: "Paid",
  declined: "Declined",
};

const STATUS_BADGE: Record<ClaimStatus, "warning" | "success" | "destructive"> = {
  requested: "warning",
  paid: "success",
  declined: "destructive",
};

export function claimTotal(claim: ClaimWithLines) {
  return (claim.claim_lines ?? []).reduce((n, l) => n + l.amount_cents, 0);
}

/** Money you're owed, or were. Never a stock movement — nothing arrived in
 * a store room, so there's nothing to count. */
export function ClaimCard({ claim }: { claim: ClaimWithLines }) {
  const router = useRouter();
  const { toast } = useToast();
  const [cancelling, setCancelling] = React.useState(false);
  const [opening, setOpening] = React.useState<string | null>(null);

  const total = claimTotal(claim);

  async function cancel() {
    setCancelling(true);
    const result = await cancelClaim(claim.id);
    setCancelling(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Claim withdrawn.", "success");
    router.refresh();
  }

  // Receipts live in a private bucket, so there's no URL to link to until
  // somebody who's allowed to see it asks for one.
  async function openReceipt(path: string) {
    setOpening(path);
    const result = await receiptUrl(path);
    setOpening(null);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" title="You bought this yourself">
          Reimbursement
        </Badge>
        <Badge variant={STATUS_BADGE[claim.status]}>{STATUS_LABEL[claim.status]}</Badge>
        {claim.zone && <Badge variant="outline">{claim.zone}</Badge>}
        <span
          className="ml-auto text-xs text-muted-foreground"
          title={formatDateTime(claim.created_at)}
        >
          {timeAgo(claim.created_at)}
        </span>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {(claim.claim_lines ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((line) => (
            <li key={line.id} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{line.description}</span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(line.amount_cents)}
              </span>
            </li>
          ))}
        <li className="flex items-baseline gap-2 border-t pt-1 font-semibold">
          <span className="min-w-0 flex-1">Total</span>
          <span className="shrink-0 tabular-nums">{formatMoney(total)}</span>
        </li>
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">Reason: {claim.reason}</p>

      {(claim.claim_receipts ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(claim.claim_receipts ?? []).map((r) => (
            <Button
              key={r.id}
              variant="outline"
              size="sm"
              loading={opening === r.path}
              onClick={() => openReceipt(r.path)}
            >
              <FileText /> {r.file_name ?? "Receipt"}
            </Button>
          ))}
        </div>
      )}

      {claim.admin_note && (
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="font-medium">Procurement:</span> {claim.admin_note}
        </p>
      )}

      {claim.status === "requested" && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            loading={cancelling}
            onClick={cancel}
          >
            <Trash2 /> Withdraw claim
          </Button>
        </div>
      )}
    </div>
  );
}
