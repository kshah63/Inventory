import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ApprovalsClient, type ApprovalRow } from "./approvals-client";
import type { PendingStatus } from "@/lib/types";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

interface PendingQueryRow {
  id: string;
  qty: number;
  status: PendingStatus;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  items: { name: string; unit: string; photo_url: string | null } | null;
  locations: { name: string } | null;
  requester: { full_name: string } | null;
  decider: { full_name: string } | null;
}

export default async function AdminApprovalsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pending_checkouts")
    .select(
      "*, items(name, unit, photo_url), locations(name), requester:users!pending_checkouts_requested_by_fkey(full_name), decider:users!pending_checkouts_decided_by_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  const rows: ApprovalRow[] = ((data ?? []) as unknown as PendingQueryRow[]).map(
    (r) => ({
      id: r.id,
      qty: r.qty,
      status: r.status,
      decision_note: r.decision_note,
      created_at: r.created_at,
      decided_at: r.decided_at,
      item_name: r.items?.name ?? "Unknown item",
      unit: r.items?.unit ?? "",
      photo_url: r.items?.photo_url ?? null,
      location_name: r.locations?.name ?? "—",
      requester_name: r.requester?.full_name ?? "Unknown",
      decider_name: r.decider?.full_name ?? null,
    })
  );

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Checkouts of approval-required items. Approve to record the checkout, or reject with a note."
      />
      <ApprovalsClient rows={rows} />
    </>
  );
}
