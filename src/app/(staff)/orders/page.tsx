import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { OrderRow } from "@/lib/types";
import { OrdersList, type StaffOrder } from "./orders-list";

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

  return (
    <div>
      <PageHeader
        title="My orders"
        description="Placed from the Shop — collect once procurement marks them ready."
      />
      <OrdersList orders={orders} />
    </div>
  );
}
