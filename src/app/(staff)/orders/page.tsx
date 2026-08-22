import { createClient, getProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { OrderRow, TransactionRow } from "@/lib/types";
import { OrdersList, type StaffOrder } from "./orders-list";
import { ActivityList } from "./activity-list";
import { RequestsList, type RequestWithJoins } from "../requests/requests-list";
import { OrdersTabs } from "./orders-tabs";
import { MarkOrdersSeen } from "./mark-seen";

export const metadata = { title: "My orders" };
export const dynamic = "force-dynamic";

export default async function MyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const profile = await getProfile();
  const supabase = await createClient();

  const [ordersRes, requestsRes, activityRes] = await Promise.all([
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
    // Strictly this person's own supplies. Filtered explicitly rather than
    // leaning on RLS, because reporting roles can read the whole ledger — and
    // limited to checkouts/returns so procurement's stock operations never
    // appear here.
    supabase
      .from("v_transactions")
      .select("*")
      .eq("user_id", profile?.id ?? "")
      .in("type", ["checkout", "return"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const orders = (ordersRes.data ?? []) as unknown as StaffOrder[];
  const requestRows = (requestsRes.data ?? []) as unknown as RequestWithJoins[];
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
  const activity = (activityRes.data ?? []) as unknown as TransactionRow[];

  // Changed since this person last looked — and not by them. Worked out here
  // so the flags survive the render that clears them.
  const isUpdated = (o: OrderRow) =>
    o.status_changed_at !== null &&
    o.status_changed_by !== o.requested_by &&
    o.status_changed_at > (o.seen_at ?? o.created_at);
  const updatedIds = orders.filter(isUpdated).map((o) => o.id);

  const openOrders = orders.filter(
    (o) => o.status === "pending" || o.status === "ready"
  ).length;
  const openRequests = requests.filter(
    (r) => r.status !== "fulfilled" && r.status !== "rejected"
  ).length;

  return (
    <div>
      <PageHeader
        title="My orders"
        description="Everything you've asked for, and everything you've collected."
      />

      <OrdersTabs
        initialTab={tab === "requests" || tab === "activity" ? tab : "orders"}
        counts={{ orders: openOrders, requests: openRequests }}
        orders={<OrdersList orders={orders} updatedIds={updatedIds} />}
        requests={<RequestsList requests={requests} />}
        activity={<ActivityList rows={activity} />}
      />

      <MarkOrdersSeen unread={updatedIds.length} />
    </div>
  );
}
