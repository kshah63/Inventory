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
import { createClaim, uploadReceipt } from "@/lib/actions/claims";
import { cn, formatMoney, friendlyError, parseMoney } from "@/lib/utils";

interface DraftLine {
  key: number;
  description: string;
  amount: string;
}

let nextKey = 1;
const emptyLine = (): DraftLine => ({ key: nextKey++, description: "", amount: "" });

/**
 * Claiming back what you bought yourself. Raised from the Order page,
 * because "how do I get what I need?" has three answers and they belong in
 * one place — but it's the last of the three, on purpose: buying it
 * yourself should be the fallback, not the shortcut.
 */
export function ClaimDialog({ zones }: { zones: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [open, setOpen] = React.useState(false);
  const [lines, setLines] = React.useState<DraftLine[]>([emptyLine()]);
  const [reason, setReason] = React.useState("");
  const [zone, setZone] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [saving, setSaving] = React.useState(false);

  function reset() {
    setLines([emptyLine()]);
    setReason("");
    setZone(null);
    setFiles([]);
    setSaving(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    if (saving) return;
    setOpen(false);
    reset();
  }

  const parsed = lines.map((l) => ({
    ...l,
    cents: parseMoney(l.amount),
    filled: l.description.trim() !== "" || l.amount.trim() !== "",
  }));
  const usable = parsed.filter((l) => l.description.trim() !== "" && l.cents !== null);
  const total = usable.reduce((n, l) => n + (l.cents ?? 0), 0);
  // Half-finished lines are the commonest mistake, so they're named rather
  // than silently dropped.
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

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const res = await createClaim({
      zone,
      reason,
      lines: usable.map((l) => ({
        description: l.description.trim(),
        amount_cents: l.cents as number,
      })),
    });
    if (!res.ok) {
      setSaving(false);
      toast(friendlyError(res.error), "error");
      return;
    }

    // Receipts after the claim exists — they hang off it, not off a line,
    // because one trip to the shop is one receipt and several lines.
    const failed: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("receipt", file);
      const up = await uploadReceipt(res.data.claim_id, fd);
      if (!up.ok) failed.push(`${file.name}: ${friendlyError(up.error)}`);
    }

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
    reset();
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Receipt />
        Claim a reimbursement
      </Button>

      <Dialog open={open} onClose={close} className="max-w-lg">
        <DialogTitle>Claim a reimbursement</DialogTitle>
        <DialogDescription>
          For something you bought yourself and paid for. Add a line per thing
          you bought, and the receipts covering them.
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>What you bought</Label>
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
                    aria-label={`What you bought, line ${i + 1}`}
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
                      aria-label={`Amount, line ${i + 1}`}
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
                Every line needs both what you bought and how much it cost.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="claim-reason">Why wasn&apos;t this ordered?</Label>
            <Textarea
              id="claim-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. We ran out mid-lesson and I was passing the shop"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Not a telling-off — if something keeps getting bought this way,
              we should be stocking more of it.
            </p>
          </div>

          {zones.length > 0 && (
            <div className="space-y-1.5">
              <Label>Which zone was this for?</Label>
              <div className="flex flex-wrap gap-1.5">
                {zones.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZone(zone === z ? null : z)}
                    aria-pressed={zone === z}
                    className={cn(
                      "h-9 min-w-[2.5rem] rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      zone === z
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "bg-card hover:bg-accent"
                    )}
                  >
                    {z}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="claim-receipts">Receipts</Label>
            {files.length > 0 && (
              <ul className="divide-y rounded-md border">
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
              Photos or PDFs, up to 10MB each. Only you and the procurement
              team can open them.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!canSave}>
            Submit claim
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
