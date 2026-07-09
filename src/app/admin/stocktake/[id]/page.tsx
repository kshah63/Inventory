import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { cn, formatDateTime } from "@/lib/utils";
import { VarianceTable, type StocktakeLineRow } from "./variance-table";

export const metadata = { title: "Stocktake report" };
export const dynamic = "force-dynamic";

interface StocktakeRow {
  id: string;
  location_id: string;
  performed_by: string;
  note: string | null;
  created_at: string;
  locations: { name: string } | null;
  users: { full_name: string } | null;
}

export default async function StocktakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [stRes, linesRes] = await Promise.all([
    supabase
      .from("stocktakes")
      .select("*, locations(name), users!stocktakes_performed_by_fkey(full_name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("stocktake_lines")
      .select("*, items(sku, name, unit)")
      .eq("stocktake_id", id),
  ]);

  if (stRes.error || !stRes.data) notFound();
  const stocktake = stRes.data as unknown as StocktakeRow;
  const lines = ((linesRes.data ?? []) as unknown as StocktakeLineRow[]).sort(
    (a, b) => (a.items?.name ?? "").localeCompare(b.items?.name ?? "")
  );

  const drifted = lines.filter((l) => l.variance !== 0).length;
  const netVariance = lines.reduce((sum, l) => sum + l.variance, 0);

  return (
    <>
      <Link
        href="/admin/stocktake"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All stocktakes
      </Link>
      <PageHeader
        title={`Stocktake — ${stocktake.locations?.name ?? "Unknown location"}`}
        description={`${formatDateTime(stocktake.created_at)} · by ${
          stocktake.users?.full_name ?? "Unknown"
        }${stocktake.note ? ` · ${stocktake.note}` : ""}`}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Lines counted" value={String(lines.length)} />
        <StatCard
          label="Lines with variance"
          value={String(drifted)}
          className={drifted > 0 ? "text-warning" : "text-success"}
        />
        <StatCard
          label="Net variance"
          value={netVariance > 0 ? `+${netVariance}` : String(netVariance)}
          className={
            netVariance < 0
              ? "text-destructive"
              : netVariance > 0
                ? "text-success"
                : undefined
          }
        />
      </div>

      <VarianceTable lines={lines} />
    </>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", className)}>
        {value}
      </p>
    </div>
  );
}
