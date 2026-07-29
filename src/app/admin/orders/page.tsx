import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import type { Location, OrderRow } from "@/lib/types";
import { OrdersAdminClient, type AdminOrder } from "./orders-admin-client";

export const metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const supabase = await createClient();
  const [ordersRes, locationsRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "*, locations(name), requester:users!orders_requested_by_fkey(full_name), packer:users!orders_packed_by_fkey(full_name), order_lines(item_id, qty_requested, qty_packed, items(name, unit, stock_levels(location_id, qty_on_hand)))"
      )
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
  ]);

  const orders = (ordersRes.data ?? []) as unknown as AdminOrder[];
  const locations = (locationsRes.data ?? []) as unknown as Location[];

  return (
    <>
      <PageHeader
        title="Orders"
        description="Pre-orders from zone admins — pack them, mark them ready, hand them over. Packing records the checkout against the requester."
      />
      <OrdersAdminClient orders={orders} locations={locations} />
    </>
  );
}
