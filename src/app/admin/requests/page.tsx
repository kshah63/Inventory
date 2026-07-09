import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RequestsClient, type AdminRequest } from "./requests-client";
import type { RequestStatus } from "@/lib/types";

export const metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

interface RequestQueryRow {
  id: string;
  qty: number;
  status: RequestStatus;
  note: string | null;
  admin_note: string | null;
  created_at: string;
  free_text_item: string | null;
  items: { name: string; unit: string } | null;
  locations: { name: string } | null;
  users: { full_name: string } | null;
}

export default async function AdminRequestsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("requests")
    .select(
      "*, items(name, unit), locations(name), users!requests_requested_by_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  const requests: AdminRequest[] = ((data ?? []) as unknown as RequestQueryRow[]).map(
    (r) => ({
      id: r.id,
      qty: r.qty,
      status: r.status,
      note: r.note,
      admin_note: r.admin_note,
      created_at: r.created_at,
      free_text_item: r.free_text_item,
      item_name: r.items?.name ?? null,
      unit: r.items?.unit ?? null,
      location_name: r.locations?.name ?? "—",
      requester_name: r.users?.full_name ?? "Unknown",
    })
  );

  return (
    <>
      <PageHeader
        title="Requests"
        description="Staff restock and new-item requests. Move each one through Open → Acknowledged → Ordered → Fulfilled."
      />
      <RequestsClient requests={requests} />
    </>
  );
}
