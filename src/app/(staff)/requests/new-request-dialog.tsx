"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createRequest } from "@/lib/actions/requests";
import { friendlyError } from "@/lib/utils";
import type { Location } from "@/lib/types";

export interface SelectableItem {
  id: string;
  name: string;
  unit: string;
}

const OTHER = "__other__";

export function NewRequestDialog({
  items,
  locations,
}: {
  items: SelectableItem[];
  locations: Location[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [itemId, setItemId] = React.useState("");
  const [freeText, setFreeText] = React.useState("");
  const [qty, setQty] = React.useState("1");
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");
  const [note, setNote] = React.useState("");

  const isOther = itemId === OTHER;

  function reset() {
    setItemId("");
    setFreeText("");
    setQty("1");
    setLocationId(locations[0]?.id ?? "");
    setNote("");
  }

  function close() {
    if (submitting) return;
    setOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) {
      toast("Pick an item or choose “Something else”.", "error");
      return;
    }
    if (isOther && !freeText.trim()) {
      toast("Describe the item you need.", "error");
      return;
    }
    const qtyNum = parseInt(qty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast("Quantity must be a positive number.", "error");
      return;
    }
    if (!locationId) {
      toast("Pick a location.", "error");
      return;
    }

    setSubmitting(true);
    const result = await createRequest({
      itemId: isOther ? null : itemId,
      freeText: isOther ? freeText.trim() : null,
      qty: qtyNum,
      locationId,
      note: note.trim() || undefined,
    });
    setSubmitting(false);

    if (result.ok) {
      toast("Request sent to procurement.", "success");
      setOpen(false);
      reset();
      router.refresh();
    } else {
      toast(friendlyError(result.error), "error");
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        New request
      </Button>

      <Dialog open={open} onClose={close}>
        <DialogTitle>New request</DialogTitle>
        <DialogDescription>
          Ask procurement to restock an item — or order something new.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="request-item">Item</Label>
            <Select
              id="request-item"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              required
            >
              <option value="" disabled>
                Select an item…
              </option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.unit})
                </option>
              ))}
              <option value={OTHER}>Something else / new item</option>
            </Select>
          </div>

          {isOther && (
            <div className="space-y-1.5">
              <Label htmlFor="request-free-text">What do you need?</Label>
              <Input
                id="request-free-text"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="e.g. A3 laminating pouches"
                maxLength={200}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="request-qty">Quantity</Label>
              <Input
                id="request-qty"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-location">Location</Label>
              <Select
                id="request-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                required
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="request-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything procurement should know — brand, urgency, class it's for…"
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Send request
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
