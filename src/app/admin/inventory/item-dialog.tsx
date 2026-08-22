"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Package, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  deleteItem,
  saveItem,
  setItemRooms,
  uploadItemPhoto,
} from "@/lib/actions/inventory";
import { cn, friendlyError } from "@/lib/utils";
import type { Category, Location } from "@/lib/types";
import type { InventoryItem } from "./inventory-grid";

export function ItemDialog({
  open,
  onClose,
  item,
  categories,
  locations,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  item: InventoryItem | null;
  categories: Category[];
  locations: Location[];
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
  const [adminOnly, setAdminOnly] = React.useState(false);
  const [isActive, setIsActive] = React.useState(true);
  const [rooms, setRooms] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  // When a delete is refused because the item has history, the alternative
  // is offered right there rather than as a dead end.
  const [deleteBlocked, setDeleteBlocked] = React.useState<string | null>(null);

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
    setAdminOnly(item?.admin_only ?? false);
    setIsActive(item?.is_active ?? true);
    // A new item starts kept everywhere; untick the rooms it isn't in.
    setRooms(
      item
        ? item.stock_levels.map((s) => s.location_id)
        : locations.map((l) => l.id)
    );
    setSaving(false);
    setConfirmDelete(false);
    setDeleting(false);
    setDeleteBlocked(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [open, item, categories, locations]);

  function toggleRoom(id: string) {
    setRooms((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

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
      adminOnly,
      isActive: item ? isActive : true,
    });
    if (!res.ok) {
      setSaving(false);
      toast(friendlyError(res.error), "error");
      return;
    }

    // Rooms after the item exists, so a new one gets its rows too. A room
    // still holding stock can't be dropped — that comes back as an error
    // naming the room, and the rest of the save stands.
    const before = item ? item.stock_levels.map((s) => s.location_id) : [];
    const changed =
      !item ||
      rooms.length !== before.length ||
      rooms.some((id) => !before.includes(id));
    if (changed) {
      const roomRes = await setItemRooms(res.data.id, rooms);
      if (!roomRes.ok) {
        setSaving(false);
        toast(friendlyError(roomRes.error), "error");
        router.refresh();
        return;
      }
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

  async function remove() {
    if (!item || deleting) return;
    setDeleting(true);
    setDeleteBlocked(null);
    const res = await deleteItem(item.id);
    if (!res.ok) {
      setDeleting(false);
      setConfirmDelete(false);
      setDeleteBlocked(friendlyError(res.error));
      return;
    }
    setDeleting(false);
    toast(`"${item.name}" deleted.`);
    router.refresh();
    onClose();
  }

  /** The alternative when a delete is refused: keep the history, drop it
   * from the catalogue. */
  async function retire() {
    if (!item || deleting) return;
    setDeleting(true);
    const res = await saveItem({
      id: item.id,
      sku: item.sku,
      name: item.name,
      categoryId: item.category_id,
      unit: item.unit,
      packSize: item.pack_size,
      notes: item.notes,
      maxPerCheckout: item.max_per_checkout,
      requiresApproval: item.requires_approval,
      adminOnly: item.admin_only,
      isActive: false,
    });
    setDeleting(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(`"${item.name}" removed from the catalogue. Its history is intact.`);
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

        <div className="space-y-1.5">
          <Label>Store rooms</Label>
          <div className="flex flex-wrap gap-1.5">
            {locations.map((l) => {
              const on = rooms.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleRoom(l.id)}
                  aria-pressed={on}
                  className={cn(
                    "h-9 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-accent"
                  )}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Where we actually keep it. An unticked room stops listing it at
            zero. A room still holding stock can&apos;t be dropped — move or
            adjust it out first.
          </p>
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

        <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/40 px-3 py-2.5">
          <div>
            <Label htmlFor="item-restricted" className="cursor-pointer">
              Central team only
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              For heavy cleaning supplies and the like. Nobody outside the
              central team can see the item, its stock levels, or find it by
              searching — and it can&apos;t be ordered.
            </p>
          </div>
          <Switch
            id="item-restricted"
            checked={adminOnly}
            onCheckedChange={setAdminOnly}
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

      {deleteBlocked && (
        <div className="mt-4 space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{deleteBlocked}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={retire}
            loading={deleting}
          >
            Remove from the catalogue instead
          </Button>
        </div>
      )}

      <DialogFooter>
        {item && (
          <div className="mr-auto flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">
                  Delete for good?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  No
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={remove}
                  loading={deleting}
                >
                  Yes, delete
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setDeleteBlocked(null);
                  setConfirmDelete(true);
                }}
                disabled={saving}
              >
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        )}
        <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!canSave || deleting}>
          {item ? "Save changes" : "Create item"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
