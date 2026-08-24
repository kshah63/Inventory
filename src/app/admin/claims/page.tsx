import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { ClaimsAdminClient, type AdminClaim } from "./claims-admin-client";
import type { ClaimWithLines } from "@/lib/types";

export const metadata = { title: "Reimbursements" };
export const dynamic = "force-dynamic";

export default async function ClaimsAdminPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("claims")
    .select("*, claim_lines(*), claim_receipts(*)")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as ClaimWithLines[];

  // Names looked up separately: claims has two foreign keys into users
  // (claimed_by and decided_by), so an embedded users(...) join would be
  // ambiguous and would fail the whole query rather than one column.
  const ids = [...new Set(rows.map((c) => c.claimed_by))];
  const { data: people } = ids.length
    ? await supabase.from("users").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameById = new Map(
    ((people ?? []) as { id: string; full_name: string }[]).map((u) => [
      u.id,
      u.full_name,
    ])
  );

  const claims: AdminClaim[] = rows.map((c) => ({
    ...c,
    claimant_name: nameById.get(c.claimed_by) ?? "Unknown",
  }));

  return (
    <>
      <PageHeader
        title="Reimbursements"
        description="Money people spent out of their own pocket. Check the receipt, mark it paid, and export the lot for whoever does the paying."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load claims: {friendlyError(error.message)}
        </p>
      ) : (
        <ClaimsAdminClient claims={claims} />
      )}
    </>
  );
}
