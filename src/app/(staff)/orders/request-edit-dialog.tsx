"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Link2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ZonePicker } from "@/components/zone-picker";
import { editRequest, uploadRequestPhoto } from "@/lib/actions/requests";
import { friendlyError } from "@/lib/utils";
import type { RequestWithJoins } from "./request-card";

/**
 * Fix a declined request and send it back, instead of raising it again from
 * scratch. The same shape as "Request a new item", pre-filled from what was
 * declined — the one thing the person reads first is procurement's reason,
 * shown on the card behind this. Resubmitting returns it to open.
 */
export function RequestEditDialog({
  request: req,
  zones,
}: {
  request: RequestWithJoins;
  zones: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [itemName, setItemName] = React.useState(req.free_text_item ?? "");
  const [description, setDescription] = React.useState(req.description ?? "");
  const [productUrl, setProductUrl] = React.useState(req.product_url ?? "");
  const [qty, setQty] = React.useState(String(req.qty));
  const [zone, setZone] = React.useState<string | null>(req.zone ?? null);

  // The photo already on the request, kept unless they remove or replace it.
  const [keptPhoto, setKeptPhoto] = React.useState<string | null>(req.photo_url);
  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  // Snap the form back to what's stored whenever it's (re)opened, so a
  // discarded edit doesn't linger.
  React.useEffect(() => {
    if (!open) return;
    setItemName(req.free_text_item ?? "");
    setDescription(req.description ?? "");
    setProductUrl(req.product_url ?? "");
    setQty(String(req.qty));
    setZone(req.zone ?? null);
    setKeptPhoto(req.photo_url);
    clearNewPhoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function clearNewPhoto() {
    setPhotoFile(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInput.current) fileInput.current.value = "";
  }

  function pickPhoto(file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast("Photo must be under 5MB.", "error");
      return;
    }
    setKeptPhoto(null);
    setPhotoFile(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function removePhoto() {
    setKeptPhoto(null);
    clearNewPhoto();
  }

  function close() {
    if (submitting) return;
    setOpen(false);
  }

  const shownPhoto = photoPreview ?? keptPhoto;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemName.trim()) {
      toast("Tell us what you need.", "error");
      return;
    }
    const qtyNum = parseInt(qty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast("Quantity must be at least 1.", "error");
      return;
    }
    if (zones.length > 0 && !zone) {
      toast("Pick which zone this is for.", "error");
      return;
    }

    setSubmitting(true);

    // A freshly chosen photo is uploaded first; otherwise keep whatever's
    // left (the old URL, or null if it was removed).
    let photoUrl: string | null = keptPhoto;
    if (photoFile) {
      const form = new FormData();
      form.append("photo", photoFile);
      const upload = await uploadRequestPhoto(form);
      if (!upload.ok) {
        setSubmitting(false);
        toast(friendlyError(upload.error), "error");
        return;
      }
      photoUrl = upload.data.url;
    }

    const result = await editRequest({
      requestId: req.id,
      itemName,
      description: description.trim() || undefined,
      productUrl: productUrl.trim() || undefined,
      photoUrl,
      qty: qtyNum,
      zone,
    });
    setSubmitting(false);

    if (result.ok) {
      toast("Resubmitted — back with procurement.", "success");
      setOpen(false);
      router.refresh();
    } else {
      toast(friendlyError(result.error), "error");
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil /> Edit &amp; resubmit
      </Button>

      <Dialog open={open} onClose={close} className="max-w-lg">
        <DialogTitle>Edit &amp; resubmit</DialogTitle>
        <DialogDescription>
          Change what was declined and send it back to procurement.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-request-item">What do you need?</Label>
            <Input
              id="edit-request-item"
              autoFocus
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. A3 laminating pouches"
              maxLength={200}
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-request-description">Describe it</Label>
            <Textarea
              id="edit-request-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brand, size, colour, what it's for…"
              maxLength={1000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-request-url">
              Link to the product{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="edit-request-url"
                type="url"
                inputMode="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://…"
                className="h-11 pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Photo{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            {shownPhoto ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shownPhoto}
                  alt="Requested item"
                  className="h-20 w-20 rounded-md border object-cover"
                />
                <Button type="button" variant="outline" size="sm" onClick={removePhoto}>
                  <X /> Remove
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus /> Add a photo
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-request-qty">How many?</Label>
            <Input
              id="edit-request-qty"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
              className="h-11 w-28"
            />
          </div>

          {zones.length > 0 && (
            <div className="space-y-1.5">
              <Label>Which zone is this for?</Label>
              <ZonePicker zones={zones} value={zone} onChange={setZone} />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Resubmit
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
