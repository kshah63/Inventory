"use client";

import * as React from "react";
import { ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QtyStepper } from "./qty-stepper";

/** Free-text request for something that isn't in the catalog (or can't be found). */
export function CantFindScreen({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (freeText: string, qty: number, note: string) => Promise<boolean>;
}) {
  const [freeText, setFreeText] = React.useState("");
  const [qty, setQty] = React.useState(1);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const canSubmit = freeText.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await onSubmit(freeText.trim(), qty, note);
    setBusy(false);
    if (ok) {
      setFreeText("");
      setQty(1);
      setNote("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="lg" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Can&apos;t find it?</h1>
      </div>
      <p className="text-lg text-muted-foreground">
        Describe what you need and the procurement team will sort it out.
      </p>

      <div className="space-y-2">
        <Label htmlFor="cantfind-item" className="text-base">
          What do you need?
        </Label>
        <Input
          id="cantfind-item"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="e.g. A3 laminating pouches"
          className="h-14 text-lg"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label className="block text-center text-base">How many?</Label>
        <QtyStepper value={qty} onChange={setQty} min={1} max={999} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cantfind-note" className="text-base">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="cantfind-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything that helps — brand, size, when you need it…"
          className="min-h-[90px] text-base"
        />
      </div>

      <Button
        type="button"
        size="xl"
        className="w-full"
        onClick={() => void submit()}
        disabled={!canSubmit}
        loading={busy}
      >
        <Send /> Send request
      </Button>
    </div>
  );
}
