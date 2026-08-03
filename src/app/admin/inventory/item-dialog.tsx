"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { saveItem, uploadItemPhoto } from "@/lib/actions/inventory";
import { friendlyError } from "@/lib/utils";
import type { Category } from "@/lib/types";
import type { InventoryItem } from "./inventory-grid";

export function ItemDialog({
  open,
  onClose,
  item,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  item: InventoryItem | null;
  categories: Category[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [unit, setUnit] = React.useState("pcs");
  const [packSizeRaw, setPackSizeRaw] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [maxRaw, setMaxRaw] = React.useState("");
  const [requiresApproval, setRequiresApproval] = React.useState(false);
  const [isActive, setIsActive] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // Re-seed the form each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setSku(item?.sku ?? "");
    setName(item?.name ?? "");
    setCategoryId(item?.category_id ?? categories[0]?.id ?? "");
    setUnit(item?.unit ?? "pcs");
    setPackSizeRaw(item?.pack_size != null ? String(item.pack_size) : "");
    setNotes(item?.notes ?? "");
    setMaxRaw(item?.max_per_checkout != null ? String(item.max_per_checkout) : "");
    setRequiresApproval(item?.requires_approval ?? false);
    setIsActive(item?.is_active ?? true);
    setSaving(false);
    if (fileRef.current) fileRef.current.value = "";
  }, [open, item, categories]);

  const packSize = packSizeRaw.trim() === "" ? null : parseInt(packSizeRaw, 10);
  const maxPerCheckout = maxRaw.trim() === "" ? null : parseInt(maxRaw, 10);
  const packSizeInvalid =
    packSize !== null && (!Number.isFinite(packSize) || packSize <= 0);
  const maxInvalid =
    maxPerCheckout !== null && (!Number.isFinite(maxPerCheckout) || maxPerCheckout <= 0);

  const canSave =
    sku.trim() !== "" &&
    name.trim() !== "" &&
    categoryId !== "" &&
    !packSizeInvalid &&
    !maxInvalid;

  async function submit() {
    if (!canSave || saving) return;
    setSaving(true);
    const res = await saveItem({
      id: item?.id,
      sku,
      name,
      categoryId,
      unit,
      packSize,
      notes: notes.trim() === "" ? null : notes,
      maxPerCheckout,
      requiresApproval,
      isActive: item ? isActive : true,
    });
    if (!res.ok) {
      setSaving(false);
      toast(friendlyError(res.error), "error");
      return;
    }

    const file = fileRef.current?.files?.[0];
    if (file && file.size > 0) {
      const fd = new FormData();
      fd.append("photo", file);
      const up = await uploadItemPhoto(res.data.id, fd);
      if (!up.ok) {
        setSaving(false);
        toast(
          `Item saved, but the photo upload failed: ${friendlyError(up.error)}`,
          "error"
        );
        router.refresh();
        onClose();
        return;
      }
    }

    setSaving(false);
    toast(item ? `"${name.trim()}" updated.` : `"${name.trim()}" created.`);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogTitle>{item ? "Edit item" : "New item"}</DialogTitle>
      <DialogDescription>
        {item
          ? "Update catalog details. Stock quantities are managed via receive, transfer and adjust."
          : "Add an item to the catalog. Set its reorder point and par level per location from the grid afterwards."}
      </DialogDescription>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="item-sku">SKU</Label>
            <Input
              id="item-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. STA-PEN-BLU"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ballpoint pen (blue)"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="item-category">Category</Label>
            <Select
              id="item-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {categories.length === 0 && <option value="">No categories yet</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {categories.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Create a category first (toolbar → New category).
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-unit">Unit</Label>
            <Input
              id="item-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="pcs / ream / box"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="item-pack">Pack size</Label>
            <Input
              id="item-pack"
              type="number"
              min={1}
              value={packSizeRaw}
              onChange={(e) => setPackSizeRaw(e.target.value)}
              placeholder="Optional, e.g. 12"
              className="tabular-nums"
            />
            {packSizeInvalid && (
              <p className="text-xs text-destructive">Pack size must be a positive number.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-max">Max per order</Label>
            <Input
              id="item-max"
              type="number"
              min={1}
              value={maxRaw}
              onChange={(e) => setMaxRaw(e.target.value)}
              placeholder="Empty = no cap"
              className="tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              The most one person can order at a time, so nobody clears the
              shelf. Empty means no cap.
            </p>
            {maxInvalid && (
              <p className="text-xs text-destructive">Max per order must be a positive number.</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="item-notes">Notes</Label>
          <Textarea
            id="item-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional — storage location, supplier, remarks…"
            rows={2}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/40 px-3 py-2.5">
          <div>
            <Label htmlFor="item-approval" className="cursor-pointer">
              Requires approval
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Checkouts need procurement approval — for toner/high-value items.
            </p>
          </div>
          <Switch
            id="item-approval"
            checked={requiresApproval}
            onCheckedChange={setRequiresApproval}
          />
        </div>

        {item && (
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/40 px-3 py-2.5">
            <div>
              <Label htmlFor="item-active" className="cursor-pointer">
                Active
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Inactive items are hidden from the catalogue but keep their
                history.
              </p>
            </div>
            <Switch id="item-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="item-photo">Photo</Label>
          <div className="flex items-center gap-3">
            {item?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.photo_url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-md border object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-muted/50">
                <Package className="h-5 w-5 text-muted-foreground/60" />
              </div>
            )}
            <Input id="item-photo" ref={fileRef} type="file" accept="image/*" />
          </div>
          <p className="text-xs text-muted-foreground">
            Optional, up to 5MB. Shown in the catalogue to help people pick the right item.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!canSave}>
          {item ? "Save changes" : "Create item"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
