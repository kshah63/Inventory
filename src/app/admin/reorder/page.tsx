import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { friendlyError } from "@/lib/utils";
import { ReorderClient } from "./reorder-client";
import type { ReorderRow } from "@/lib/types";

export const metadata = { title: "Reorder" };
export const dynamic = "force-dynamic";

export default async function ReorderPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_reorder_dashboard");
  const rows = (data ?? []) as unknown as ReorderRow[];

  return (
    <>
      <PageHeader
        title="Reorder"
        description="Items appear here when on-hand stock is at or below its reorder point — set reorder points in Inventory. Suggested qty tops each item back up to par."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load the reorder list: {friendlyError(error.message)}
        </p>
      ) : (
        <ReorderClient rows={rows} />
      )}
    </>
  );
}
