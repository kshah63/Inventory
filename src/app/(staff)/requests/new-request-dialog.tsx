"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Info, Link2, PackageCheck, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ZonePicker } from "@/components/zone-picker";
import { createRequest, searchCatalogue, uploadRequestPhoto } from "@/lib/actions/requests";
import { cn, friendlyError } from "@/lib/utils";
import type { CatalogueMatch } from "@/lib/types";

/** Requests are only for items the catalogue doesn't carry — catalogue items
 * are ordered from the Catalogue page instead. */
export function NewRequestDialog({
  zones,
  onOrderInstead,
}: {
  zones: string[];
  /** Adds a catalogue item to the order instead of raising a request. */
  onOrderInstead?: (match: CatalogueMatch) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [itemName, setItemName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [productUrl, setProductUrl] = React.useState("");
  const [qty, setQty] = React.useState("1");
  const [zone, setZone] = React.useState<string | null>(null);

  const [matches, setMatches] = React.useState<CatalogueMatch[]>([]);
  const [dismissedMatches, setDismissedMatches] = React.useState(false);

  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  // Look for what they're describing while they type. Debounced so it
  // follows a pause rather than every keystroke.
  React.useEffect(() => {
    const q = itemName.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchCatalogue(q);
      if (!cancelled) setMatches(found);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [itemName]);

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInput.current) fileInput.current.value = "";
  }

  function reset() {
    setItemName("");
    setDescription("");
    setProductUrl("");
    setQty("1");
    setZone(null);
    setMatches([]);
    setDismissedMatches(false);
    clearPhoto();
  }

  function pickPhoto(file: File | null) {
    if (!file) {
      clearPhoto();
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("Photo must be under 5MB.", "error");
      return;
    }
    setPhotoFile(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function close() {
    if (submitting) return;
    setOpen(false);
  }

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

    // Upload the photo first so the request is stored with its URL.
    let photoUrl: string | undefined;
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

    const result = await createRequest({
      itemName,
      description: description.trim() || undefined,
      productUrl: productUrl.trim() || undefined,
      photoUrl,
      qty: qtyNum,
      zone,
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
        Request a new item
      </Button>

      <Dialog open={open} onClose={close} className="max-w-lg">
        <DialogTitle>Request a new item</DialogTitle>
        <DialogDescription>For something we don&apos;t stock yet.</DialogDescription>

        <div className="mb-5 flex items-start gap-2 rounded-md border border-primary/30 bg-accent p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Type what you need — if we already stock it, it&apos;ll show up
            below and you can order it straight away.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="request-item">What do you need?</Label>
            <Input
              id="request-item"
              autoFocus
              required
              value={itemName}
              onChange={(e) => {
                setItemName(e.target.value);
                setDismissedMatches(false);
              }}
              placeholder="e.g. A3 laminating pouches"
              maxLength={200}
              className="h-11"
            />
          </div>

          {/* What we already have that sounds like it. Never blocks the
              request — it just saves a wait when we had it all along. */}
          {matches.length > 0 && !dismissedMatches && onOrderInstead && (
            <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <PackageCheck className="h-4 w-4 text-success" />
                We stock {matches.length === 1 ? "this" : "these"} already
              </p>
              <ul className="space-y-1.5">
                {matches.map((m) => (
                  <li
                    key={m.item_id}
                    className="flex items-center gap-3 rounded-md bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.sku} ·{" "}
                        {m.qty_on_hand > 0
                          ? `${m.qty_on_hand} ${m.unit} in stock`
                          : "out of stock"}
                        {m.matched_alias && ` · also called "${m.matched_alias}"`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        onOrderInstead(m);
                        setOpen(false);
                        reset();
                      }}
                    >
                      <Check /> Order this
                    </Button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setDismissedMatches(true)}
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
              >
                None of these — carry on with my request
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            {/* Presented as expected, not enforced — a blank description
                shouldn't block a request from reaching procurement. */}
            <Label htmlFor="request-description">Describe it</Label>
            <Textarea
              id="request-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brand, size, colour, what it's for…"
              maxLength={1000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request-url">
              Link to the product{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="request-url"
                type="url"
                inputMode="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://…"
                className="h-11 pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              If you found it online, paste the link — it saves procurement
              hunting for it.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>
              Photo{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            {photoPreview ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Selected item"
                  className="h-20 w-20 rounded-md border object-cover"
                />
                <Button type="button" variant="outline" size="sm" onClick={clearPhoto}>
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
            <Label htmlFor="request-qty">How many?</Label>
            <Input
              id="request-qty"
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
              Send request
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
