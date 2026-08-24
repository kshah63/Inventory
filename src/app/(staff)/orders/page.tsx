import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import type { ClaimWithLines, OrderRow } from "@/lib/types";
import { type StaffOrder } from "./order-card";
import { type RequestWithJoins } from "./request-card";
import { TrackingList } from "./tracking-list";
import { ClaimsList } from "./claims-list";
import { TrackingTabs } from "./tracking-tabs";
import { MarkOrdersSeen } from "./mark-seen";

export const metadata = { title: "Track my orders" };
export const dynamic = "force-dynamic";

/** Still in flight, whichever way it was asked for. */
const ORDER_OPEN = ["pending", "ready"];
const REQUEST_OPEN = ["open", "acknowledged", "ordered", "received", "ready"];

export default async function TrackMyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const supabase = await createClient();

  const [ordersRes, requestsRes, claimsRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "*, locations(name), order_lines(item_id, qty_requested, qty_packed, items(name, unit))"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    // RLS limits staff to their own requests. Plain columns only: requests
    // has two foreign keys into items, so an embedded items(...) join is
    // ambiguous and errors — which would empty this list silently.
    supabase
      .from("requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    // RLS keeps this to your own. Only one foreign key into each child
    // table, so these embeds are unambiguous.
    supabase
      .from("claims")
      .select("*, claim_lines(*), claim_receipts(*)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const loadError = ordersRes.error ?? requestsRes.error ?? claimsRes.error;
  const orders = (ordersRes.data ?? []) as unknown as StaffOrder[];
  const requestRows = (requestsRes.data ?? []) as unknown as RequestWithJoins[];
  const claims = (claimsRes.data ?? []) as unknown as ClaimWithLines[];

  // Catalogue items only appear on requests raised before the catalogue and
  // requests split apart, so this lookup is usually empty.
  const requestItemIds = [
    ...new Set(requestRows.map((r) => r.item_id).filter(Boolean)),
  ] as string[];
  const requestItems = requestItemIds.length
    ? await supabase.from("items").select("id, name, unit").in("id", requestItemIds)
    : null;
  const requestItemById = new Map(
    ((requestItems?.data ?? []) as { id: string; name: string; unit: string }[]).map(
      (i) => [i.id, { name: i.name, unit: i.unit }]
    )
  );
  const requests: RequestWithJoins[] = requestRows.map((r) => ({
    ...r,
    items: r.item_id ? requestItemById.get(r.item_id) ?? null : null,
  }));

  // Changed since this person last looked — and not by them. Worked out here
  // so the flags survive the render that clears them.
  const isUpdated = (o: OrderRow) =>
    o.status_changed_at !== null &&
    o.status_changed_by !== o.requested_by &&
    o.status_changed_at > (o.seen_at ?? o.created_at);
  const updatedIds = orders.filter(isUpdated).map((o) => o.id);

  const waitingOrders = orders.filter((o) => ORDER_OPEN.includes(o.status));
  const waitingRequests = requests.filter((r) => REQUEST_OPEN.includes(r.status));
  const doneOrders = orders.filter((o) => !ORDER_OPEN.includes(o.status));
  const doneRequests = requests.filter((r) => !REQUEST_OPEN.includes(r.status));

  return (
    <div>
      <PageHeader
        title="Track my orders"
        description="Everything you've asked for, and everything you've collected."
      />

      {loadError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load everything: {friendlyError(loadError.message)}
        </p>
      )}

      <TrackingTabs
        initialTab={
          tab === "collected" ? "collected" : tab === "claims" ? "claims" : "waiting"
        }
        waitingCount={waitingOrders.length + waitingRequests.length}
        claimsCount={claims.filter((c) => c.status === "requested").length}
        waiting={
          <TrackingList
            orders={waitingOrders}
            requests={waitingRequests}
            updatedIds={updatedIds}
            variant="waiting"
          />
        }
        collected={
          <TrackingList
            orders={doneOrders}
            requests={doneRequests}
            variant="collected"
          />
        }
        claims={<ClaimsList claims={claims} />}
      />

      <MarkOrdersSeen unread={updatedIds.length} />
    </div>
  );
}
