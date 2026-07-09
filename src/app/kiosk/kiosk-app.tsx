"use client";

import * as React from "react";
import { Check, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { useWakeLock } from "@/hooks/use-wake-lock";
import {
  endKioskSession,
  kioskCheckout,
  kioskCreateRequest,
  kioskRequestApproval,
  kioskReturn,
} from "@/lib/actions/kiosk";
import { cn, formatDate, formatTime, friendlyError } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Logo } from "@/components/logo";
import type {
  BasketLine,
  CatalogItem,
  Category,
  CheckoutResult,
  KioskSessionInfo,
  Location,
} from "@/lib/types";
import { UserPicker, initialsOf } from "./user-picker";
import { PinPad } from "./pin-pad";
import { Catalog } from "./catalog";
import { BasketBar, type BasketDisplayLine } from "./basket";
import { ReturnScreen } from "./return-screen";
import { CantFindScreen } from "./cant-find";
import { ConfirmScreen } from "./confirm-screen";

/** Row shape returned by the kiosk_get_staff RPC (and the directory fallback). */
export interface KioskStaff {
  id: string;
  full_name: string;
  department: string | null;
}

type Screen = "picker" | "pin" | "shop" | "return" | "cantfind" | "confirm";

const IDLE_SECONDS = 45;

interface KioskAppProps {
  locationId: string;
  locationName: string;
  locations: Location[];
  categories: Category[];
  items: CatalogItem[];
  staff: KioskStaff[];
}

export function KioskApp({
  locationId,
  locationName,
  locations,
  categories,
  items: initialItems,
  staff,
}: KioskAppProps) {
  useWakeLock();
  const { toast } = useToast();
  const supabase = React.useMemo(() => createClient(), []);

  const [screen, setScreen] = React.useState<Screen>("picker");
  const [pendingStaff, setPendingStaff] = React.useState<KioskStaff | null>(null);
  const [session, setSession] = React.useState<KioskSessionInfo | null>(null);
  const [items, setItems] = React.useState<CatalogItem[]>(initialItems);
  const [basket, setBasket] = React.useState<BasketLine[]>([]);
  const [checkoutResult, setCheckoutResult] = React.useState<CheckoutResult | null>(null);
  const [checkingOut, setCheckingOut] = React.useState(false);

  const sessionRef = React.useRef(session);
  sessionRef.current = session;

  // ── Live stock: reflect every stock_levels update in local state ──────────
  React.useEffect(() => {
    const channel = supabase
      .channel("kiosk-stock-levels")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "stock_levels" },
        (payload) => {
          const row = payload.new as unknown as {
            item_id?: string;
            location_id?: string;
            qty_on_hand?: number;
          };
          if (!row.item_id || !row.location_id || typeof row.qty_on_hand !== "number") return;
          setItems((prev) =>
            prev.map((it) => {
              if (it.id !== row.item_id) return it;
              const exists = it.stock_levels.some((sl) => sl.location_id === row.location_id);
              return {
                ...it,
                stock_levels: exists
                  ? it.stock_levels.map((sl) =>
                      sl.location_id === row.location_id
                        ? { ...sl, qty_on_hand: row.qty_on_hand! }
                        : sl
                    )
                  : [
                      ...it.stock_levels,
                      { location_id: row.location_id!, qty_on_hand: row.qty_on_hand! },
                    ],
              };
            })
          );
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  /** Full stock re-sync (after every checkout, and after checkout errors). */
  const syncStock = React.useCallback(async () => {
    const { data } = await supabase
      .from("stock_levels")
      .select("item_id, location_id, qty_on_hand");
    if (!data) return;
    const byItem = new Map<string, { location_id: string; qty_on_hand: number }[]>();
    for (const r of data as unknown as {
      item_id: string;
      location_id: string;
      qty_on_hand: number;
    }[]) {
      const arr = byItem.get(r.item_id) ?? [];
      arr.push({ location_id: r.location_id, qty_on_hand: r.qty_on_hand });
      byItem.set(r.item_id, arr);
    }
    setItems((prev) => prev.map((it) => ({ ...it, stock_levels: byItem.get(it.id) ?? [] })));
  }, [supabase]);

  // ── Session lifecycle ──────────────────────────────────────────────────────
  const resetToPicker = React.useCallback((endCurrentSession: boolean) => {
    const current = sessionRef.current;
    if (endCurrentSession && current) void endKioskSession(current.token);
    setSession(null);
    setPendingStaff(null);
    setBasket([]);
    setCheckoutResult(null);
    setCheckingOut(false);
    setScreen("picker");
  }, []);

  // No stale sessions, no misattributed checkouts: 45s idle → back to picker.
  useIdleTimeout(() => resetToPicker(true), IDLE_SECONDS, screen !== "picker");

  /** Toast a friendly message; a dead session always bounces back to the picker. */
  const handleActionError = React.useCallback(
    (error: string) => {
      toast(friendlyError(error), "error");
      if (error === "SESSION_EXPIRED") resetToPicker(false);
    },
    [toast, resetToPicker]
  );

  // ── Basket ────────────────────────────────────────────────────────────────
  const setBasketLine = React.useCallback((itemId: string, qty: number) => {
    setBasket((prev) => {
      const idx = prev.findIndex((l) => l.item_id === itemId);
      if (idx === -1) return qty > 0 ? [...prev, { item_id: itemId, qty }] : prev;
      if (qty <= 0) return prev.filter((l) => l.item_id !== itemId);
      const next = [...prev];
      next[idx] = { item_id: itemId, qty };
      return next;
    });
  }, []);

  const basketLines: BasketDisplayLine[] = basket.map((line) => {
    const item = items.find((i) => i.id === line.item_id);
    return { ...line, name: item?.name ?? "Item", unit: item?.unit ?? "" };
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleDone = React.useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    if (basket.length === 0) {
      // Nothing in the basket — "Done" just signs out.
      resetToPicker(true);
      return;
    }
    setCheckingOut(true);
    const result = await kioskCheckout(current.token, basket);
    setCheckingOut(false);
    void syncStock();
    if (!result.ok) {
      // e.g. someone took the last unit — stay in the shop so qty can be adjusted.
      handleActionError(result.error);
      return;
    }
    setBasket([]);
    setCheckoutResult(result.data);
    setScreen("confirm");
  }, [basket, resetToPicker, syncStock, handleActionError]);

  const handleRequestApproval = React.useCallback(
    async (item: CatalogItem, qty: number): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current) return false;
      const result = await kioskRequestApproval(current.token, item.id, qty);
      if (!result.ok) {
        handleActionError(result.error);
        return false;
      }
      toast(`${result.data.item_name}: sent for approval — you'll be notified.`);
      return true;
    },
    [handleActionError, toast]
  );

  const handleRequestRestock = React.useCallback(
    async (item: CatalogItem, qty: number, note: string): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current) return false;
      const result = await kioskCreateRequest(current.token, {
        itemId: item.id,
        freeText: null,
        qty,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        handleActionError(result.error);
        return false;
      }
      toast(`Restock request sent for ${item.name}.`);
      return true;
    },
    [handleActionError, toast]
  );

  const handleReturn = React.useCallback(
    async (itemId: string, qty: number, note: string): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current) return false;
      const result = await kioskReturn(current.token, itemId, qty, note.trim() || undefined);
      if (!result.ok) {
        handleActionError(result.error);
        return false;
      }
      toast(`Returned ${result.data.qty} × ${result.data.name}. Thanks!`);
      void syncStock();
      setScreen("shop");
      return true;
    },
    [handleActionError, toast, syncStock]
  );

  const handleCantFind = React.useCallback(
    async (freeText: string, qty: number, note: string): Promise<boolean> => {
      const current = sessionRef.current;
      if (!current) return false;
      const result = await kioskCreateRequest(current.token, {
        itemId: null,
        freeText,
        qty,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        handleActionError(result.error);
        return false;
      }
      toast("Request sent — the team will take a look.");
      setScreen("shop");
      return true;
    },
    [handleActionError, toast]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const showBasket = screen === "shop" && basketLines.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <Badge variant="secondary" className="shrink-0 gap-1.5 px-3 py-1 text-sm">
            <MapPin className="h-3.5 w-3.5" />
            {locationName}
          </Badge>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {session ? (
            <>
              <span className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {initialsOf(session.full_name)}
                </span>
                <span className="hidden max-w-[12rem] truncate text-lg font-semibold sm:block">
                  {session.full_name}
                </span>
              </span>
              {screen === "shop" && (
                <Button size="lg" onClick={handleDone} loading={checkingOut}>
                  <Check /> Done
                </Button>
              )}
            </>
          ) : (
            <LiveClock />
          )}
        </div>
      </header>

      <main className={cn("flex-1", showBasket && "pb-32")}>
        {screen === "picker" && (
          <UserPicker
            staff={staff}
            onPick={(s) => {
              setPendingStaff(s);
              setScreen("pin");
            }}
          />
        )}

        {screen === "pin" && pendingStaff && (
          <PinPad
            staff={pendingStaff}
            onCancel={() => resetToPicker(false)}
            onSuccess={(info) => {
              setSession(info);
              setScreen("shop");
            }}
          />
        )}

        {screen === "shop" && session && (
          <Catalog
            items={items}
            categories={categories}
            locations={locations}
            locationId={locationId}
            basket={basket}
            onTake={(item, qty) => setBasketLine(item.id, qty)}
            onRequestApproval={handleRequestApproval}
            onRequestRestock={handleRequestRestock}
            onReturnItems={() => setScreen("return")}
            onCantFind={() => setScreen("cantfind")}
          />
        )}

        {screen === "return" && session && (
          <ReturnScreen
            items={items}
            locationId={locationId}
            onBack={() => setScreen("shop")}
            onReturn={handleReturn}
          />
        )}

        {screen === "cantfind" && session && (
          <CantFindScreen onBack={() => setScreen("shop")} onSubmit={handleCantFind} />
        )}

        {screen === "confirm" && checkoutResult && (
          <ConfirmScreen
            result={checkoutResult}
            userName={session?.full_name ?? ""}
            onFinish={() => resetToPicker(true)}
          />
        )}
      </main>

      {showBasket && (
        <BasketBar
          lines={basketLines}
          onRemove={(itemId) => setBasketLine(itemId, 0)}
          onDone={handleDone}
          busy={checkingOut}
        />
      )}
    </div>
  );
}

/** Header clock (Asia/Singapore). Mount-gated to avoid hydration mismatch. */
function LiveClock() {
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return <div className="h-10 w-24" aria-hidden />;
  const iso = now.toISOString();
  return (
    <div className="text-right leading-tight">
      <div className="text-lg font-semibold tabular-nums">{formatTime(iso)}</div>
      <div className="text-xs text-muted-foreground">{formatDate(iso)}</div>
    </div>
  );
}
