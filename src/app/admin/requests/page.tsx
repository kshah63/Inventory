import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { RequestsClient, type AdminRequest } from "./requests-client";
import { friendlyError } from "@/lib/utils";
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
  description: string | null;
  product_url: string | null;
  photo_url: string | null;
  zone: string | null;
  item_id: string | null;
  requested_by: string;
  expected_date: string | null;
}

export default async function AdminRequestsPage() {
  const supabase = await createClient();

  // Plain columns, then look up the names separately. Embedded joins name a
  // foreign key, and this table has two into items and one into users — an
  // ambiguous or renamed one comes back as an error, which reads as an empty
  // queue and loses people's requests in plain sight.
  const { data, error } = await supabase
    .from("requests")
    .select(
      "id, qty, status, note, admin_note, created_at, free_text_item, description, product_url, photo_url, zone, item_id, requested_by, expected_date"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  const rows = (data ?? []) as unknown as RequestQueryRow[];

  const itemIds = [...new Set(rows.map((r) => r.item_id).filter(Boolean))] as string[];
  const requesterIds = [...new Set(rows.map((r) => r.requested_by))];

  const [itemsRes, peopleRes] = await Promise.all([
    itemIds.length
      ? supabase.from("items").select("id, name, unit").in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    requesterIds.length
      ? supabase.from("users").select("id, full_name").in("id", requesterIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const itemById = new Map(
    ((itemsRes.data ?? []) as { id: string; name: string; unit: string }[]).map((i) => [
      i.id,
      i,
    ])
  );
  const nameById = new Map(
    ((peopleRes.data ?? []) as { id: string; full_name: string }[]).map((u) => [
      u.id,
      u.full_name,
    ])
  );

  const requests: AdminRequest[] = rows.map((r) => ({
    id: r.id,
    qty: r.qty,
    status: r.status,
    note: r.note,
    admin_note: r.admin_note,
    created_at: r.created_at,
    free_text_item: r.free_text_item,
    description: r.description,
    product_url: r.product_url,
    photo_url: r.photo_url,
    zone: r.zone,
    expected_date: r.expected_date,
    item_name: r.item_id ? itemById.get(r.item_id)?.name ?? null : null,
    unit: r.item_id ? itemById.get(r.item_id)?.unit ?? null : null,
    requester_name: nameById.get(r.requested_by) ?? "Unknown",
  }));

  const loadError =
    error?.message ?? itemsRes.error?.message ?? peopleRes.error?.message ?? null;

  return (
    <>
      <PageHeader
        title="Requests"
        description="Items the catalogue doesn't carry. Move each one through Open → Acknowledged → Ordered → Fulfilled."
      />
      {loadError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load the queue: {friendlyError(loadError)}
        </p>
      )}
      <RequestsClient requests={requests} />
    </>
  );
}
