import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, friendlyError } from "@/lib/utils";
import { StocktakeClient, type StockItemOption } from "./stocktake-client";
import type { Location } from "@/lib/types";

export const metadata = { title: "Stocktake" };
export const dynamic = "force-dynamic";

interface PastStocktake {
  id: string;
  location_id: string;
  performed_by: string;
  note: string | null;
  created_at: string;
  locations: { name: string } | null;
  users: { full_name: string } | null;
}

export default async function StocktakePage() {
  const supabase = await createClient();
  const [locRes, itemRes, pastRes] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("items")
      .select("id, sku, name, unit, category:categories(name), stock_levels(location_id, qty_on_hand)")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("stocktakes")
      .select("*, locations(name), users!stocktakes_performed_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const error = locRes.error ?? itemRes.error ?? pastRes.error;
  const locations = (locRes.data ?? []) as unknown as Location[];
  const items = (itemRes.data ?? []) as unknown as StockItemOption[];
  const past = (pastRes.data ?? []) as unknown as PastStocktake[];

  return (
    <>
      <PageHeader
        title="Stocktake"
        description="Count what's physically on the shelf — variances are recorded as adjustments and kept as a report, so shrinkage shows up instead of hiding."
      />
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load data: {friendlyError(error.message)}
        </p>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">
              Start a stocktake
            </h2>
            <StocktakeClient locations={locations} items={items} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">
              Past stocktakes
            </h2>
            {past.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="No stocktakes yet"
                description="Run your first count above — the variance report will appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Report</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {past.map((st) => (
                    <TableRow key={st.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(st.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {st.locations?.name ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {st.users?.full_name ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                        {st.note ?? ""}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/admin/stocktake/${st.id}`}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          View report
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </>
  );
}
