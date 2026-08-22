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
import { saveCategory } from "@/lib/actions/inventory";
import { cn, friendlyError } from "@/lib/utils";
import { matchesWords, queryWords, searchableText } from "@/lib/search";
import type { Category, Item, Location } from "@/lib/types";
import { ItemDialog } from "./item-dialog";
import { ImportDialog } from "./import-dialog";

/** Item joined with category name and full stock params — the grid row shape. */
export interface InventoryItem extends Item {
  category: { name: string } | null;
  stock_levels: { location_id: string; qty_on_hand: number }[];
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

/** Out if there's none anywhere; low once we're down to about half of what
 * we like to keep. Untracked items are never low — there's no target to be
 * below. Same rule the dashboard and Reorder use. */
function totalOnHand(item: InventoryItem) {
  return (item.stock_levels ?? []).reduce((n, s) => n + s.qty_on_hand, 0);
}

function stockState(item: InventoryItem): Exclude<StockFilter, "all"> {
  const total = totalOnHand(item);
  if (total === 0) return "out";
  if (item.keep_about !== null && total * 2 <= item.keep_about) return "low";
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
      ...locations.map((l) => `${l.name} qty`),
      "keep_about",
      "max_per_checkout",
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
        ...locations.map((l) => {
          const s = stockAt(item, l.id);
          return s ? String(s.qty_on_hand) : "";
        }),
        item.keep_about === null ? "" : String(item.keep_about),
        item.max_per_checkout === null ? "" : String(item.max_per_checkout),
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
                      {item.keep_about !== null && (
                        <Badge
                          variant="outline"
                          title="Roughly how many we like to have, across both rooms"
                        >
                          Keep about {item.keep_about}
                        </Badge>
                      )}
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

/** Per-room cell: just the count. How many we like to keep is one number
 * on the item now, not two per room. */
function StockCell({ item, location }: { item: InventoryItem; location: Location }) {
  const stock = stockAt(item, location.id);

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

  const qty = stock.qty_on_hand;
  const low =
    item.keep_about !== null && totalOnHand(item) * 2 <= item.keep_about;

  return (
    <TableCell>
      <span
        className={cn(
          "font-semibold tabular-nums",
          qty === 0 ? "text-destructive" : low ? "text-warning" : undefined
        )}
      >
        {qty}
      </span>
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
