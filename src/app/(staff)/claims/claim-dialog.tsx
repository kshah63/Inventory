"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Receipt, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  createClaim,
  editClaim,
  removeReceipt,
  uploadReceipt,
} from "@/lib/actions/claims";
import { cn, formatMoney, friendlyError, parseMoney } from "@/lib/utils";
import { ZonePicker } from "@/components/zone-picker";

interface DraftLine {
  key: number;
  description: string;
  amount: string;
}

/** An existing claim, when the dialog is opened to edit and resubmit one. */
export interface EditableClaim {
  id: string;
  zone: string | null;
  reason: string;
  claim_lines: { id: string; description: string; amount_cents: number; sort_order: number }[];
  claim_receipts: { id: string; path: string; file_name: string | null }[];
}

let nextKey = 1;
const emptyLine = (): DraftLine => ({ key: nextKey++, description: "", amount: "" });

/**
 * Claiming back what you bought yourself. Raised from the Order page — but
 * also opened in edit mode from Track my orders when a claim was declined, so
 * the person can fix what procurement flagged and resubmit rather than start
 * over. In edit mode it pre-fills the claim and calls editClaim, which sends
 * it back for review.
 */
export function ClaimDialog({
  zones,
  claim,
}: {
  zones: string[];
  /** Present → edit-and-resubmit mode for this declined claim. */
  claim?: EditableClaim;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const isEdit = claim != null;

  const initialLines = (): DraftLine[] =>
    isEdit && claim.claim_lines.length > 0
      ? claim.claim_lines
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((l) => ({
            key: nextKey++,
            description: l.description,
            amount: (l.amount_cents / 100).toFixed(2),
          }))
      : [emptyLine()];

  const [open, setOpen] = React.useState(false);
  const [lines, setLines] = React.useState<DraftLine[]>(initialLines);
  const [reason, setReason] = React.useState(isEdit ? claim.reason : "");
  const [zone, setZone] = React.useState<string | null>(isEdit ? claim.zone : null);
  const [files, setFiles] = React.useState<File[]>([]);
  // Receipts already attached (edit mode) — removable before resubmitting.
  const [existing, setExisting] = React.useState(isEdit ? claim.claim_receipts : []);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  function resetToInitial() {
    setLines(initialLines());
    setReason(isEdit ? claim.reason : "");
    setZone(isEdit ? claim.zone : null);
    setFiles([]);
    setExisting(isEdit ? claim.claim_receipts : []);
    setSaving(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    if (saving) return;
    setOpen(false);
    resetToInitial();
  }

  const parsed = lines.map((l) => ({
    ...l,
    cents: parseMoney(l.amount),
    filled: l.description.trim() !== "" || l.amount.trim() !== "",
  }));
  const usable = parsed.filter((l) => l.description.trim() !== "" && l.cents !== null);
  const total = usable.reduce((n, l) => n + (l.cents ?? 0), 0);
  const brokenLine = parsed.find(
    (l) => l.filled && (l.description.trim() === "" || l.cents === null)
  );
  const canSave =
    !saving &&
    usable.length > 0 &&
    !brokenLine &&
    reason.trim() !== "" &&
    (zones.length === 0 || zone !== null);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    setFiles((f) => [...f, ...Array.from(picked)]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removeExisting(receiptId: string) {
    setRemovingId(receiptId);
    const res = await removeReceipt(receiptId);
    setRemovingId(null);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    setExisting((rs) => rs.filter((r) => r.id !== receiptId));
  }

  async function uploadNew(claimId: string): Promise<string[]> {
    const failed: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("receipt", file);
      const up = await uploadReceipt(claimId, fd);
      if (!up.ok) failed.push(`${file.name}: ${friendlyError(up.error)}`);
    }
    return failed;
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const payload = {
      zone,
      reason,
      lines: usable.map((l) => ({
        description: l.description.trim(),
        amount_cents: l.cents as number,
      })),
    };

    if (isEdit) {
      const res = await editClaim({ claimId: claim.id, ...payload });
      if (!res.ok) {
        setSaving(false);
        toast(friendlyError(res.error), "error");
        return;
      }
      const failed = await uploadNew(claim.id);
      setSaving(false);
      toast(
        failed.length > 0
          ? `Resubmitted, but ${failed.length} receipt${failed.length === 1 ? "" : "s"} didn't upload. (${failed[0]})`
          : "Claim resubmitted for review.",
        failed.length > 0 ? "error" : "success"
      );
      setOpen(false);
      router.refresh();
      return;
    }

    const res = await createClaim(payload);
    if (!res.ok) {
      setSaving(false);
      toast(friendlyError(res.error), "error");
      return;
    }
    const failed = await uploadNew(res.data.claim_id);
    setSaving(false);
    if (failed.length > 0) {
      toast(
        `Claim submitted, but ${failed.length} receipt${failed.length === 1 ? "" : "s"} didn't upload. Add ${failed.length === 1 ? "it" : "them"} from Track my orders. (${failed[0]})`,
        "error"
      );
    } else {
      toast(`Claim for ${formatMoney(res.data.total_cents)} submitted.`, "success");
    }
    setOpen(false);
    resetToInitial();
    router.refresh();
  }

  return (
    <>
      {isEdit ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Receipt />
          Edit &amp; resubmit
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Receipt />
          Claim a reimbursement
        </Button>
      )}

      <Dialog open={open} onClose={close} className="max-w-lg">
        <DialogTitle>{isEdit ? "Edit & resubmit claim" : "Claim a reimbursement"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Fix what procurement flagged and resubmit — it goes back for review."
            : "For purchases made with your own money. Add a line for each item, and attach the receipts that cover them."}
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="min-w-0 flex-1">Items purchased</Label>
              <Label className="w-28 shrink-0">Cost (SGD)</Label>
              <span className="w-9 shrink-0" aria-hidden="true" />
            </div>
            {lines.map((line, i) => {
              const cents = parseMoney(line.amount);
              const amountBad = line.amount.trim() !== "" && cents === null;
              return (
                <div key={line.key} className="flex items-start gap-2">
                  <Input
                    value={line.description}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((l) =>
                          l.key === line.key ? { ...l, description: e.target.value } : l
                        )
                      )
                    }
                    placeholder="e.g. Whiteboard markers ×4"
                    aria-label={`Item purchased, line ${i + 1}`}
                  />
                  <div className="w-28 shrink-0">
                    <Input
                      value={line.amount}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((l) =>
                            l.key === line.key ? { ...l, amount: e.target.value } : l
                          )
                        )
                      }
                      placeholder="0.00"
                      inputMode="decimal"
                      className={cn("tabular-nums", amountBad && "border-destructive")}
                      aria-label={`Cost in dollars, line ${i + 1}`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((ls) => ls.filter((l) => l.key !== line.key))
                    }
                    aria-label={`Remove line ${i + 1}`}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((ls) => [...ls, emptyLine()])}
              >
                <Plus /> Add a line
              </Button>
              <span className="text-sm">
                <span className="text-muted-foreground">Total </span>
                <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
              </span>
            </div>
            {brokenLine && (
              <p className="text-xs text-destructive">
                Each line needs a description and an amount.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="claim-reason">Why was this purchased rather than ordered?</Label>
            <Textarea
              id="claim-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. It was urgent and easier to purchase myself"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              This helps the procurement team identify items worth keeping in
              stock.
            </p>
          </div>

          {zones.length > 0 && (
            <div className="space-y-1.5">
              <Label>Which zone was this for?</Label>
              <ZonePicker zones={zones} value={zone} onChange={setZone} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="claim-receipts">Receipts</Label>
            {(existing.length > 0 || files.length > 0) && (
              <ul className="divide-y rounded-md border">
                {existing.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.file_name ?? "Receipt"}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      loading={removingId === r.id}
                      onClick={() => removeExisting(r.id)}
                      aria-label={`Remove ${r.file_name ?? "receipt"}`}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setFiles((fs) => fs.filter((_, n) => n !== i))}
                      aria-label={`Remove ${f.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                id="claim-receipts"
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={(e) => addFiles(e.target.files)}
              />
              <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              Photos or PDFs, up to 10MB each. Receipts are visible only to
              you and the procurement team.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!canSave}>
            {isEdit ? "Resubmit claim" : "Submit claim"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
