"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Download, FileText, Receipt, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { receiptUrl, setClaimStatus } from "@/lib/actions/claims";
import {
  cn,
  formatDate,
  formatDateTime,
  formatMoney,
  friendlyError,
  timeAgo,
} from "@/lib/utils";
import type { ClaimStatus, ClaimWithLines } from "@/lib/types";

export interface AdminClaim extends ClaimWithLines {
  claimant_name: string;
}

const TABS: { key: ClaimStatus; label: string }[] = [
  { key: "requested", label: "To pay" },
  { key: "paid", label: "Paid" },
  { key: "declined", label: "Declined" },
];

const total = (c: AdminClaim) =>
  (c.claim_lines ?? []).reduce((n, l) => n + l.amount_cents, 0);

function csvEscape(v: string) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function ClaimsAdminClient({ claims }: { claims: AdminClaim[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = React.useState<ClaimStatus>("requested");
  const [opening, setOpening] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // Declining needs a reason, so it goes through a dialog rather than a tap.
  const [declining, setDeclining] = React.useState<AdminClaim | null>(null);
  const [declineNote, setDeclineNote] = React.useState("");

  const shown = claims.filter((c) => c.status === tab);
  const counts = Object.fromEntries(
    TABS.map((t) => [t.key, claims.filter((c) => c.status === t.key).length])
  ) as Record<ClaimStatus, number>;
  const owed = claims
    .filter((c) => c.status === "requested")
    .reduce((n, c) => n + total(c), 0);

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

  async function markPaid(claim: AdminClaim) {
    setBusy(claim.id);
    const result = await setClaimStatus({ claimId: claim.id, status: "paid" });
    setBusy(null);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast(`${formatMoney(total(claim))} to ${claim.claimant_name} marked paid.`);
    router.refresh();
  }

  async function confirmDecline() {
    if (!declining || !declineNote.trim()) return;
    setBusy(declining.id);
    const result = await setClaimStatus({
      claimId: declining.id,
      status: "declined",
      adminNote: declineNote,
    });
    setBusy(null);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Claim declined, with your reason.");
    setDeclining(null);
    setDeclineNote("");
    router.refresh();
  }

  /** What whoever actually pays needs: one row per line, with the claim's
   * total repeated so it reconciles either way round. */
  function exportCsv() {
    const header = [
      "claim_id",
      "claimant",
      "zone",
      "raised",
      "status",
      "settled",
      "description",
      "amount",
      "claim_total",
      "reason",
      "note",
    ];
    const lines = [header.map(csvEscape).join(",")];
    for (const c of shown) {
      const claimTotal = (total(c) / 100).toFixed(2);
      for (const l of c.claim_lines ?? []) {
        lines.push(
          [
            c.id,
            c.claimant_name,
            c.zone ?? "",
            formatDate(c.created_at),
            c.status,
            c.decided_at ? formatDate(c.decided_at) : "",
            l.description,
            (l.amount_cents / 100).toFixed(2),
            claimTotal,
            c.reason,
            c.admin_note ?? "",
          ]
            .map((v) => csvEscape(String(v)))
            .join(",")
        );
      }
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mathvision-claims-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${shown.length} claim${shown.length === 1 ? "" : "s"}.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ClaimStatus)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
                {counts[t.key] > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {counts[t.key]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-3">
          {owed > 0 && (
            <span className="text-sm">
              <span className="text-muted-foreground">Outstanding </span>
              <span className="font-semibold tabular-nums">{formatMoney(owed)}</span>
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={shown.length === 0}
          >
            <Download /> Export CSV
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={tab === "requested" ? "Nothing to pay" : "Nothing here"}
          description={
            tab === "requested"
              ? "Claims appear here when a purchase is submitted for reimbursement."
              : "Claims appear here once they have been settled."
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((c) => (
            <div key={c.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.claimant_name}</span>
                {c.zone && <Badge variant="outline">{c.zone}</Badge>}
                <span className="font-semibold tabular-nums">
                  {formatMoney(total(c))}
                </span>
                <span
                  className="ml-auto text-xs text-muted-foreground"
                  title={formatDateTime(c.created_at)}
                >
                  {timeAgo(c.created_at)}
                </span>
              </div>

              <ul className="mt-3 space-y-1 text-sm">
                {(c.claim_lines ?? [])
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((l) => (
                    <li key={l.id} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate">{l.description}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(l.amount_cents)}
                      </span>
                    </li>
                  ))}
              </ul>

              <p className="mt-2 text-xs text-muted-foreground">Reason: {c.reason}</p>

              {(c.claim_receipts ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(c.claim_receipts ?? []).map((r) => (
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
              ) : (
                <p className="mt-2 text-xs text-warning">No receipt attached.</p>
              )}

              {c.admin_note && (
                <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">Note:</span> {c.admin_note}
                </p>
              )}

              {c.status === "requested" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    loading={busy === c.id}
                    onClick={() => markPaid(c)}
                  >
                    <Check /> Mark paid
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy === c.id}
                    onClick={() => {
                      setDeclining(c);
                      setDeclineNote("");
                    }}
                  >
                    <X /> Decline
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={declining !== null}
        onClose={() => setDeclining(null)}
        className="max-w-md"
      >
        {declining && (
          <>
            <DialogTitle>
              Decline {formatMoney(total(declining))} to {declining.claimant_name}?
            </DialogTitle>
            <DialogDescription>
              The reason is shown to the claimant, so give one they can act
              on.
            </DialogDescription>
            <div className="space-y-1.5">
              <Label htmlFor="decline-note">Reason</Label>
              <Textarea
                id="decline-note"
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)}
                placeholder="e.g. No receipt attached — please add one and claim again"
                rows={3}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeclining(null)}
                disabled={busy === declining.id}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDecline}
                loading={busy === declining.id}
                disabled={!declineNote.trim()}
                className={cn(!declineNote.trim() && "opacity-60")}
              >
                Decline claim
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}
