"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { fulfilRequestFromStock, searchCatalogue } from "@/lib/actions/requests";
import { cn, friendlyError } from "@/lib/utils";
import type { CatalogueMatch } from "@/lib/types";

/** "We already stock that" — turns a request into a real order for whoever
 * asked, rather than a note telling them to go and order it themselves. */
export function StockMatchDialog({
  request,
  onClose,
}: {
  request: { id: string; label: string; qty: number; requester: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [query, setQuery] = React.useState(request.label);
  const [matches, setMatches] = React.useState<CatalogueMatch[]>([]);
  const [searching, setSearching] = React.useState(true);
  const [chosen, setChosen] = React.useState<CatalogueMatch | null>(null);
  const [qty, setQty] = React.useState(String(request.qty));
  const [remember, setRemember] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchCatalogue(q);
      if (!cancelled) {
        setMatches(found);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function confirm() {
    if (!chosen) return;
    const qtyNum = parseInt(qty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast("Quantity must be at least 1.", "error");
      return;
    }
    setSaving(true);
    const result = await fulfilRequestFromStock({
      requestId: request.id,
      itemId: chosen.item_id,
      qty: qtyNum,
      // Only worth remembering when they asked for it in different words.
      rememberAlias:
        remember && request.label.toLowerCase() !== chosen.name.toLowerCase()
          ? request.label
          : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast(
      `Order #${result.data.order_no} raised for ${request.requester} — ${result.data.item_name}.`,
      "success"
    );
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onClose={saving ? () => {} : onClose} className="max-w-lg">
      <DialogTitle>We stock this</DialogTitle>
      <DialogDescription>
        Pick what they actually meant. It becomes an order for{" "}
        {request.requester} in the packing queue, and the request closes.
      </DialogDescription>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sm-search">They asked for</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="sm-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setChosen(null);
              }}
              className="h-11 pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Matching items</Label>
          {searching ? (
            <p className="text-sm text-muted-foreground">Looking…</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing close. Try different words — or close this and treat it as
              a genuinely new item.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {matches.map((m) => (
                <li key={m.item_id}>
                  <button
                    type="button"
                    onClick={() => setChosen(m)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                      chosen?.item_id === m.item_id
                        ? "border-primary bg-accent"
                        : "hover:bg-accent"
                    )}
                  >
                    <PackageCheck
                      className={cn(
                        "h-4 w-4 shrink-0",
                        chosen?.item_id === m.item_id
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.sku} ·{" "}
                        {m.qty_on_hand > 0
                          ? `${m.qty_on_hand} ${m.unit} in stock`
                          : "out of stock"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {chosen && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="sm-qty">How many to order for them</Label>
              <Input
                id="sm-qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-11 w-28"
              />
            </div>

            {request.label.toLowerCase() !== chosen.name.toLowerCase() && (
              <label className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
                <Switch checked={remember} onCheckedChange={setRemember} />
                <span className="text-sm">
                  Remember <strong>&ldquo;{request.label}&rdquo;</strong> as another
                  name for {chosen.name}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    The next person typing that will be shown this item before
                    they raise a request.
                  </span>
                </span>
              </label>
            )}
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={confirm} loading={saving} disabled={!chosen}>
          Raise the order
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
