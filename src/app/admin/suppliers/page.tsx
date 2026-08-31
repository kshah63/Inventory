import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { SuppliersClient } from "./suppliers-client";
import type { SupplierGroup, SupplierSubgroup, SupplierRow } from "@/lib/types";

export const metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

/** The supplier register — the portal is the master, QuickBooks follows.
 * RLS keeps every one of these tables central-team-only, so this page is
 * empty rather than leaky if anyone else ever reaches the URL. */
export default async function SuppliersPage() {
  const supabase = await createClient();

  const [groupsRes, subgroupsRes, suppliersRes] = await Promise.all([
    supabase.from("supplier_groups").select("code, name").order("code"),
    supabase
      .from("supplier_subgroups")
      .select("id, group_code, code_start, code_end, name")
      .order("group_code")
      .order("code_start"),
    // One foreign key each way, so the embed is unambiguous.
    supabase
      .from("suppliers")
      .select("*, supplier_aliases(id, alias, old_code)")
      .order("group_code")
      .order("sub_code"),
  ]);

  const error = groupsRes.error ?? subgroupsRes.error ?? suppliersRes.error;
  const groups = (groupsRes.data ?? []) as unknown as SupplierGroup[];
  const subgroups = (subgroupsRes.data ?? []) as unknown as SupplierSubgroup[];
  const suppliers = (suppliersRes.data ?? []) as unknown as SupplierRow[];

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="The single source of truth for supplier codes. Add a supplier here first — the code is assigned automatically — then apply it in QuickBooks."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load the register: {friendlyError(error.message)}
        </p>
      ) : (
        <SuppliersClient groups={groups} subgroups={subgroups} suppliers={suppliers} />
      )}
    </>
  );
}
