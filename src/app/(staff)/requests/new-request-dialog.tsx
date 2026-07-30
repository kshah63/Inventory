"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Info, Link2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createRequest, uploadRequestPhoto } from "@/lib/actions/requests";
import { cn, friendlyError } from "@/lib/utils";

/** Requests are only for items the catalogue doesn't carry — catalogue items
 * are ordered from the Catalogue page instead. */
export function NewRequestDialog({ zones }: { zones: string[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [itemName, setItemName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [productUrl, setProductUrl] = React.useState("");
  const [qty, setQty] = React.useState("1");
  const [zone, setZone] = React.useState<string | null>(null);

  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

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
      toast("Pick which department this is for.", "error");
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
            Already in the catalogue? Order it from <strong>Catalogue</strong>{" "}
            instead — it&apos;s much quicker. Use this form only for items we
            don&apos;t carry.
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
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. A3 laminating pouches"
              maxLength={200}
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request-description">
              Describe it{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
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
              <Label>Which department is this for?</Label>
              <div className="flex flex-wrap gap-1.5">
                {zones.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZone(zone === z ? null : z)}
                    aria-pressed={zone === z}
                    className={cn(
                      "h-10 min-w-[3rem] rounded-full border px-3 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
