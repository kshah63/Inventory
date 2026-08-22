"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Package,
  Search,
  SearchX,
  ShieldAlert,
  ShoppingBag,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { matchesWords, queryWords, relevance, searchableText } from "@/lib/search";
import { createOrder } from "@/lib/actions/orders";
import { NewRequestDialog } from "@/app/(staff)/requests/new-request-dialog";
import type {
  BasketLine,
  CatalogItem,
  CatalogueMatch,
  Category,
  Location,
} from "@/lib/types";

/** Three rows of three on a laptop. */
const PAGE_SIZE = 9;

function totalStock(item: CatalogItem): number {
  return item.stock_levels.reduce((n, sl) => n + sl.qty_on_hand, 0);
}

export function CatalogueClient({
  items,
  locations,
  categories,
  zones,
  aliases = {},
}: {
  items: CatalogItem[];
  locations: Location[];
  categories: Category[];
  zones: string[];
  /** Extra names per item, learned from requests procurement resolved. */
  aliases?: Record<string, string[]>;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [query, setQuery] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [cart, setCart] = React.useState<BasketLine[]>([]);
  const [page, setPage] = React.useState(0);

  // Item dialog
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState(1);
  const [perPack, setPerPack] = React.useState(false);

  // Order review
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [zone, setZone] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [placing, setPlacing] = React.useState(false);

  // Precomputed once: name, code and any learned aliases, lowercased.
  const haystacks = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, searchableText(item, aliases[item.id]));
    }
    return map;
  }, [items, aliases]);

  const filtered = React.useMemo(() => {
    // Words, not a phrase — "pen blue" and "blue pen" find the same item.
    const words = queryWords(query);
    const hits = items.filter((item) => {
      if (categoryId && item.category_id !== categoryId) return false;
      if (words.length === 0) return true;
      return matchesWords(haystacks.get(item.id) ?? "", words);
    });
    if (words.length === 0) return hits;
    // Best answers first, so they land on the first page rather than
    // wherever the alphabet puts them.
    return [...hits].sort((a, b) => {
      const byScore =
        relevance(b, haystacks.get(b.id) ?? "", query, words) -
        relevance(a, haystacks.get(a.id) ?? "", query, words);
      if (byScore !== 0) return byScore;
      // Then the plainer name: "BLUE PEN 0.7MM" before "BLUE PEN REFILL BOX".
      if (a.name.length !== b.name.length) return a.name.length - b.name.length;
      return a.name.localeCompare(b.name);
    });
  }, [items, query, categoryId, haystacks]);

  // Nine at a time — three rows of three on a laptop — so the whole page fits
  // without scrolling and you step through the catalogue instead.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // A new search or category starts again at the first page.
  React.useEffect(() => {
    setPage(0);
  }, [query, categoryId]);

  const usedCategoryIds = React.useMemo(
    () => new Set(items.map((i) => i.category_id)),
    [items]
  );
  const visibleCategories = categories.filter((c) => usedCategoryIds.has(c.id));

  const cartQty = React.useMemo(
    () => new Map(cart.map((l) => [l.item_id, l.qty])),
    [cart]
  );
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);

  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;
  const available = selected ? totalStock(selected) : 0;
  const packSize = selected?.pack_size ?? null;
  const packChoice = packSize != null && packSize > 1 && available >= packSize;
  const usePack = perPack && packChoice && packSize != null;
  // Procurement can cap how much of an item one order may take, so a single
  // person can't clear the shelf.
  const perOrderCap = selected?.max_per_checkout ?? null;
  const maxUnits = Math.max(1, Math.min(available || 1, perOrderCap ?? Infinity));
  const effectiveMax = usePack ? Math.max(1, Math.floor(maxUnits / packSize)) : maxUnits;
  const clampedQty = Math.max(1, Math.min(qty, effectiveMax));
  const baseQty = usePack ? clampedQty * packSize : clampedQty;

  const setCartLine = (itemId: string, nextQty: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.item_id === itemId);
      if (idx === -1) return nextQty > 0 ? [...prev, { item_id: itemId, qty: nextQty }] : prev;
      if (nextQty <= 0) return prev.filter((l) => l.item_id !== itemId);
      const next = [...prev];
      next[idx] = { item_id: itemId, qty: nextQty };
      return next;
    });
  };

  /** From the request form: they meant something we already stock. */
  const addMatchToCart = (match: CatalogueMatch) => {
    const cap = match.max_per_order ?? Infinity;
    const already = cartQty.get(match.item_id) ?? 0;
    const next = Math.min(already + 1, cap);
    setCartLine(match.item_id, next);
    toast(`${match.name} added to your order.`, "success");
  };

  const openItem = (item: CatalogItem) => {
    setSelectedId(item.id);
    setQty(cartQty.get(item.id) ?? 1);
    setPerPack(false);
  };

  const stockLabel = (item: CatalogItem, locationId_: string) =>
    item.stock_levels.find((sl) => sl.location_id === locationId_)?.qty_on_hand ?? 0;

  // Everything is collected from the procurement room, so nobody picks a store
  // room any more. We tag the order with whichever room holds most of what was
  // asked for; procurement confirms the room it actually packs from.
  const sourceLocationId = React.useMemo(() => {
    if (locations.length === 0) return "";
    let best = locations[0].id;
    let bestQty = -1;
    for (const l of locations) {
      const onHand = cart.reduce((n, line) => {
        const item = items.find((i) => i.id === line.item_id);
        return n + (item ? stockLabel(item, l.id) : 0);
      }, 0);
      if (onHand > bestQty) {
        bestQty = onHand;
        best = l.id;
      }
    }
    return best;
  }, [cart, items, locations]);

  async function placeOrder() {
    if (!sourceLocationId) {
      toast("No store room is set up yet — ask procurement.", "error");
      return;
    }
    setPlacing(true);
    const result = await createOrder({
      locationId: sourceLocationId,
      zone,
      lines: cart,
      note: note.trim() || undefined,
    });
    setPlacing(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(
      `Order #${result.data.order_no} placed — it'll turn Ready to collect in My supplies.`
    );
    setCart([]);
    setReviewOpen(false);
    setZone(null);
    setNote("");
    router.push("/orders");
    router.refresh();
  }

  return (
    <div className={cn("space-y-4", cart.length > 0 && "pb-24")}>
      {/* Search and categories stay put while you page through the shelves. */}
      <div className="sticky top-0 z-30 -mx-4 space-y-3 bg-background/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items or codes…"
            className="h-11 pl-10"
            aria-label="Search items"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>
            All
          </Chip>
          {visibleCategories.map((c) => (
            <Chip
              key={c.id}
              active={categoryId === c.id}
              onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
            >
              {c.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* Asking for something new starts in the same place as looking for
          something old — and the form checks the shelves as you type. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
          {query.trim() && ` matching “${query.trim()}”`}
        </span>
        <NewRequestDialog zones={zones} onOrderInstead={addMatchToCart} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nothing matches"
          description="Try a different search — or add it as a request if we don't stock it yet."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {pageItems.map((item) => {
            const inCart = cartQty.get(item.id) ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                className="flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* Photo — or the placeholder waiting for a real picture */}
                <div className="relative flex h-24 w-full items-center justify-center bg-muted">
                  {item.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.photo_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground/50">
                      <Package className="h-8 w-8" />
                      <span className="text-[10px] uppercase tracking-wide">Photo coming</span>
                    </div>
                  )}
                  {item.requires_approval && (
                    <Badge variant="warning" className="absolute left-1.5 top-1.5 gap-1 text-[10px]">
                      <ShieldAlert className="h-3 w-3" /> Approval
                    </Badge>
                  )}
                  {inCart > 0 && (
                    <Badge className="absolute right-1.5 top-1.5">×{inCart}</Badge>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                  <span className="line-clamp-2 text-sm font-semibold leading-snug">
                    {item.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{item.sku}</span>
                  <span className="mt-1 text-xs">
                    {(() => {
                      const n = totalStock(item);
                      return n === 0 ? (
                        <span className="font-semibold text-destructive">Out of stock</span>
                      ) : (
                        <>
                          <span className="font-semibold text-success">{n}</span>
                          <span className="text-muted-foreground"> in stock</span>
                        </>
                      );
                    })()}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pager — step through the catalogue nine at a time */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
          >
            <ChevronLeft /> Back
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + pageItems.length} of{" "}
            {filtered.length}
          </span>
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next page"
          >
            Next <ChevronRight />
          </Button>
        </div>
      )}

      {/* Cart bar */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShoppingBag className="h-4 w-4" />
              {cartCount} {cartCount === 1 ? "item" : "items"}
            </span>
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
              {cart.map((line) => {
                const item = items.find((i) => i.id === line.item_id);
                return (
                  <span
                    key={line.item_id}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border bg-muted py-0.5 pl-3 pr-1 text-sm"
                  >
                    <span className="font-semibold tabular-nums">{line.qty}×</span>
                    <span className="max-w-[8rem] truncate">{item?.name ?? "Item"}</span>
                    <button
                      type="button"
                      onClick={() => setCartLine(line.item_id, 0)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${item?.name ?? "item"}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                );
              })}
            </div>
            <Button onClick={() => setReviewOpen(true)}>
              <Check /> Place order
            </Button>
          </div>
        </div>
      )}

      {/* Item dialog */}
      <Dialog open={!!selected} onClose={() => setSelectedId(null)}>
        {selected && (
          <>
            <DialogTitle>{selected.name}</DialogTitle>
            <DialogDescription>
              {selected.sku}
              {" · "}
              {available === 0
                ? "Out of stock"
                : `${available} ${selected.unit} in stock`}
              {perOrderCap !== null && (
                <span className="mt-1 block">
                  Up to {perOrderCap} {selected.unit} per order, so there&apos;s
                  enough to go round.
                </span>
              )}
              {selected.requires_approval && (
                <span className="mt-1 block text-warning">
                  Subject to procurement approval when packing.
                </span>
              )}
            </DialogDescription>

            {packChoice && packSize != null && (
              <div className="mb-3 flex gap-2">
                <Chip active={!perPack} onClick={() => setPerPack(false)}>
                  Single {selected.unit}
                </Chip>
                <Chip active={perPack} onClick={() => setPerPack(true)}>
                  Pack of {packSize}
                </Chip>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Label htmlFor="shop-qty" className="shrink-0">
                Quantity
              </Label>
              <Input
                id="shop-qty"
                type="number"
                min={1}
                max={effectiveMax}
                value={clampedQty}
                onChange={(e) => setQty(Number(e.target.value) || 1)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">
                {usePack
                  ? `pack${clampedQty === 1 ? "" : "s"} of ${packSize} = ${baseQty} ${selected.unit}`
                  : selected.unit}
              </span>
            </div>
            {available === 0 && (
              <p className="mt-2 text-sm text-destructive">
                Out of stock — you can still order it; procurement will pack it
                when stock arrives, or use Requests for new items.
              </p>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setSelectedId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setCartLine(selected.id, baseQty);
                  setSelectedId(null);
                }}
              >
                {cartQty.has(selected.id) ? "Update" : "Add"} — {baseQty} {selected.unit}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>

      {/* Order review */}
      <Dialog open={reviewOpen} onClose={placing ? () => {} : () => setReviewOpen(false)}>
        <DialogTitle>Place order</DialogTitle>
        <DialogDescription>
          Procurement packs it from the store room. Check My supplies — it turns
          Ready to collect when it&apos;s waiting for you.
        </DialogDescription>

        <ul className="mb-4 divide-y rounded-lg border">
          {cart.map((line) => {
            const item = items.find((i) => i.id === line.item_id);
            return (
              <li key={line.item_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-10 shrink-0 font-semibold tabular-nums">{line.qty}×</span>
                <span className="min-w-0 flex-1 truncate">{item?.name ?? "Item"}</span>
                <button
                  type="button"
                  onClick={() => setCartLine(line.item_id, 0)}
                  disabled={placing}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="space-y-3">
          {zones.length > 0 && (
            <div>
              <Label className="mb-1.5 block">Which zone is this for?</Label>
              <div className="flex flex-wrap gap-1.5">
                {zones.map((z) => (
                  <Chip key={z} active={zone === z} onClick={() => setZone(zone === z ? null : z)}>
                    {z}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="order-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="order-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. needed before Saturday classes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={placing}>
            Back
          </Button>
          <Button
            onClick={placeOrder}
            loading={placing}
            disabled={cart.length === 0 || (zones.length > 0 && zone === null)}
          >
            <Check /> Place order · {cartCount} {cartCount === 1 ? "item" : "items"}
          </Button>
        </DialogFooter>
        {zones.length > 0 && zone === null && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Pick a zone to continue.
          </p>
        )}
      </Dialog>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-card text-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
