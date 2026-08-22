"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  FolderPlus,
  Lock,
  Package,
  Pencil,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { saveCategory, setStockParams } from "@/lib/actions/inventory";
import { cn, friendlyError } from "@/lib/utils";
import { matchesWords, queryWords, searchableText } from "@/lib/search";
import type { Category, Item, Location } from "@/lib/types";
import { ItemDialog } from "./item-dialog";
import { ImportDialog } from "./import-dialog";

/** Item joined with category name and full stock params — the grid row shape. */
export interface InventoryItem extends Item {
  category: { name: string } | null;
  stock_levels: {
    location_id: string;
    qty_on_hand: number;
    reorder_point: number;
    par_level: number;
  }[];
}

function stockAt(item: InventoryItem, locationId: string) {
  return item.stock_levels.find((s) => s.location_id === locationId) ?? null;
}

type StockFilter = "all" | "out" | "low" | "in";

const STOCK_FILTERS: { key: StockFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "out", label: "Out of stock" },
  { key: "low", label: "Low" },
  { key: "in", label: "In stock" },
];

/** Out if nothing anywhere; low if any room is at or below its reorder
 * point; otherwise in stock. Matches how the dashboard counts. */
function stockState(item: InventoryItem): Exclude<StockFilter, "all"> {
  const rows = item.stock_levels ?? [];
  const total = rows.reduce((n, s) => n + s.qty_on_hand, 0);
  if (total === 0) return "out";
  if (rows.some((s) => s.reorder_point > 0 && s.qty_on_hand <= s.reorder_point))
    return "low";
  return "in";
}

export function InventoryGrid({
  items,
  categories,
  locations,
  initialStockFilter,
}: {
  items: InventoryItem[];
  categories: Category[];
  locations: Location[];
  initialStockFilter?: StockFilter;
}) {
  const [search, setSearch] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [showInactive, setShowInactive] = React.useState(false);
  const [stockFilter, setStockFilter] = React.useState<StockFilter>(
    initialStockFilter ?? "all"
  );

  const [itemDialog, setItemDialog] = React.useState<{
    open: boolean;
    item: InventoryItem | null;
  }>({ open: false, item: null });
  const [importOpen, setImportOpen] = React.useState(false);
  const [categoryOpen, setCategoryOpen] = React.useState(false);

  const words = queryWords(search);
  const filtered = items.filter((i) => {
    if (!showInactive && !i.is_active) return false;
    if (categoryId && i.category_id !== categoryId) return false;
    if (words.length && !matchesWords(searchableText(i), words)) return false;
    if (stockFilter !== "all" && stockState(i) !== stockFilter) return false;
    return true;
  });

  function exportCsv() {
    const header = [
      "sku",
      "name",
      "category",
      "unit",
      "pack_size",
      ...locations.flatMap((l) => [`${l.name} qty`, `${l.name} reorder`, `${l.name} par`]),
      "max_per_checkout",
      "requires_approval",
      "central_team_only",
      "notes",
    ];
    const lines = [header.map(csvEscape).join(",")];
    for (const item of items) {
      const cells = [
        item.sku,
        item.name,
        item.category?.name ?? "",
        item.unit,
        item.pack_size === null ? "" : String(item.pack_size),
        ...locations.flatMap((l) => {
          const s = stockAt(item, l.id);
          return [
            s ? String(s.qty_on_hand) : "",
            s ? String(s.reorder_point) : "",
            s ? String(s.par_level) : "",
          ];
        }),
        item.max_per_checkout === null ? "" : String(item.max_per_checkout),
        item.requires_approval ? "true" : "false",
        item.admin_only ? "true" : "false",
        item.notes ?? "",
      ];
      lines.push(cells.map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mathvision-inventory.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or SKU…"
              className="pl-9"
              aria-label="Search items"
            />
          </div>
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-48"
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-1.5">
            {STOCK_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStockFilter(f.key)}
                aria-pressed={stockFilter === f.key}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  stockFilter === f.key
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent"
                )}
              >
                {f.label}
                {f.key !== "all" && (
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {items.filter((i) => i.is_active && stockState(i) === f.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
              aria-label="Show inactive items"
            />
            <Label htmlFor="show-inactive" className="cursor-pointer text-muted-foreground">
              Show inactive
            </Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCategoryOpen(true)}>
            <FolderPlus /> New category
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload /> Import CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download /> Export CSV
          </Button>
          <Button size="sm" onClick={() => setItemDialog({ open: true, item: null })}>
            <Plus /> New item
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title={items.length === 0 ? "No items yet" : "No items match"}
          description={
            items.length === 0
              ? "Add your first item, or import the whole catalog from a CSV file."
              : "Try a different search, category, or include inactive items."
          }
        >
          {items.length === 0 && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setItemDialog({ open: true, item: null })}>
                <Plus /> New item
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload /> Import CSV
              </Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>Item</TableHead>
                {locations.map((l) => (
                  <TableHead key={l.id}>{l.name}</TableHead>
                ))}
                <TableHead className="w-16 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id} className={cn(!item.is_active && "opacity-60")}>
                  <TableCell>
                    {item.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.photo_url}
                        alt=""
                        className="h-9 w-9 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/50">
                        <Package className="h-4 w-4 text-muted-foreground/60" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {item.sku} · {item.unit}
                        {item.category?.name ? ` · ${item.category.name}` : ""}
                      </span>
                      {item.admin_only && (
                        <Badge
                          variant="secondary"
                          title="Central team only — hidden from everyone else"
                        >
                          <Lock className="mr-1 h-3 w-3" /> Central team only
                        </Badge>
                      )}
                      {item.requires_approval && <Badge variant="warning">Approval</Badge>}
                      {item.max_per_checkout !== null && (
                        <Badge variant="outline" title="Most one person can order at a time">
                          Max {item.max_per_checkout} per order
                        </Badge>
                      )}
                      {!item.is_active && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                  </TableCell>
                  {locations.map((l) => (
                    <StockCell key={l.id} item={item} location={l} />
                  ))}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setItemDialog({ open: true, item })}
                      aria-label={`Edit ${item.name}`}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {items.length} items.
          </p>
        </>
      )}

      <ItemDialog
        open={itemDialog.open}
        onClose={() => setItemDialog((d) => ({ ...d, open: false }))}
        item={itemDialog.item}
        categories={categories}
        locations={locations}
      />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        locations={locations}
      />
      <CategoryDialog open={categoryOpen} onClose={() => setCategoryOpen(false)} />
    </div>
  );
}

/** Per-location cell: qty on hand plus a tiny inline reorder/par editor. */
function StockCell({ item, location }: { item: InventoryItem; location: Location }) {
  const router = useRouter();
  const { toast } = useToast();
  const stock = stockAt(item, location.id);
  const qty = stock?.qty_on_hand ?? 0;
  const reorder = stock?.reorder_point ?? 0;
  const par = stock?.par_level ?? 0;

  const [editing, setEditing] = React.useState(false);
  const [reorderRaw, setReorderRaw] = React.useState("");
  const [parRaw, setParRaw] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // No row means we don't keep it here at all — which is different from
  // keeping it here and having run out. Showing a zero for both is what made
  // the Basement look like it held a hundred things it has never held.
  if (!stock) {
    return (
      <TableCell>
        <span
          className="text-muted-foreground/60"
          title={`Not kept in ${location.name}. Add the room in Edit → Store rooms.`}
        >
          —
        </span>
      </TableCell>
    );
  }

  function openEditor() {
    setReorderRaw(String(reorder));
    setParRaw(String(par));
    setEditing(true);
  }

  async function save() {
    const r = reorderRaw.trim() === "" ? 0 : parseInt(reorderRaw, 10);
    const p = parRaw.trim() === "" ? 0 : parseInt(parRaw, 10);
    if (!Number.isFinite(r) || !Number.isFinite(p) || r < 0 || p < 0) {
      toast("Reorder point and par level must be zero or more.", "error");
      return;
    }
    setSaving(true);
    const res = await setStockParams({
      itemId: item.id,
      locationId: location.id,
      reorderPoint: r,
      parLevel: p,
    });
    setSaving(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(`Reorder/par updated for ${item.name} at ${location.name}.`);
    setEditing(false);
    router.refresh();
  }

  return (
    <TableCell>
      {editing ? (
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            R
            <Input
              type="number"
              min={0}
              value={reorderRaw}
              onChange={(e) => setReorderRaw(e.target.value)}
              className="h-7 w-14 px-1.5 text-xs tabular-nums"
              aria-label={`Reorder point at ${location.name}`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            P
            <Input
              type="number"
              min={0}
              value={parRaw}
              onChange={(e) => setParRaw(e.target.value)}
              className="h-7 w-14 px-1.5 text-xs tabular-nums"
              aria-label={`Par level at ${location.name}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-success"
            onClick={save}
            loading={saving}
            aria-label="Save reorder point and par level"
          >
            {!saving && <Check />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => setEditing(false)}
            disabled={saving}
            aria-label="Cancel"
          >
            <X />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start">
          <span
            className={cn(
              "font-semibold tabular-nums",
              qty === 0
                ? "text-destructive"
                : reorder > 0 && qty <= reorder
                  ? "text-warning"
                  : undefined
            )}
          >
            {qty}
          </span>
          <button
            type="button"
            onClick={openEditor}
            className="rounded-sm text-[11px] tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Edit reorder point / par level at ${location.name}`}
          >
            R:{reorder} / P:{par}
          </button>
        </div>
      )}
    </TableCell>
  );
}

/** Small dialog for adding a category. */
function CategoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    const res = await saveCategory(name);
    setSaving(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(`Category "${name.trim()}" added.`);
    setName("");
    router.refresh();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-sm">
      <DialogTitle>New category</DialogTitle>
      <DialogDescription>
        Categories group items in the catalogue and in reports.
      </DialogDescription>
      <div className="space-y-1.5">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cleaning supplies"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!name.trim()}>
          Add category
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
