import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { OrderRow } from "@/lib/types";
import { OrdersList, type StaffOrder } from "./orders-list";
import { MarkOrdersSeen } from "./mark-seen";

export const metadata = { title: "My orders" };
export const dynamic = "force-dynamic";

export default async function MyOrdersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "*, locations(name), order_lines(item_id, qty_requested, qty_packed, items(name, unit))"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const orders = (data ?? []) as unknown as (OrderRow & {
    locations: { name: string } | null;
    order_lines: {
      item_id: string;
      qty_requested: number;
      qty_packed: number | null;
      items: { name: string; unit: string } | null;
    }[];
  })[] as StaffOrder[];

  // Changed since this person last looked — and not by them. Worked out here
  // so the flags survive the render that clears them.
  const isUpdated = (o: StaffOrder) =>
    o.status_changed_at !== null &&
    o.status_changed_by !== o.requested_by &&
    o.status_changed_at > (o.seen_at ?? o.created_at);
  const updatedIds = orders.filter(isUpdated).map((o) => o.id);

  return (
    <div>
      <PageHeader
        title="My orders"
        description="Placed from the Catalogue — collect once procurement marks them ready."
      />
      <OrdersList orders={orders} updatedIds={updatedIds} />
      <MarkOrdersSeen unread={updatedIds.length} />
    </div>
  );
}
