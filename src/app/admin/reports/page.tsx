import { BarChart3, LineChart, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { friendlyError } from "@/lib/utils";
import type { ConsumptionRow } from "@/lib/types";
import { DailyUsageChart, type DailyUsagePoint } from "./daily-usage-chart";
import { ReportFilters, type ReportGroupBy } from "./report-filters";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];
const GROUPS: ReportGroupBy[] = ["user", "item", "category", "zone"];

const GROUP_LABELS: Record<ReportGroupBy, string> = {
  user: "user",
  item: "item",
  category: "category",
  zone: "department",
};

function param(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
}

/** YYYY-MM-DD for a Date, in Asia/Singapore. */
function sgtDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(d);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeParam = Number(param(sp.range));
  const range = RANGES.includes(rangeParam) ? rangeParam : 30;
  const byParam = param(sp.by) as ReportGroupBy;
  const by: ReportGroupBy = GROUPS.includes(byParam) ? byParam : "item";

  const to = new Date();
  const from = new Date(to.getTime() - range * 24 * 60 * 60 * 1000);

  const supabase = await createClient();
  const [dailyRes, consumptionRes, itemRes] = await Promise.all([
    supabase.rpc("report_daily_usage", { p_days: range }),
    supabase.rpc("report_consumption", {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_group_by: by,
    }),
    // Fastest movers always group by item; reuse the main query when by=item.
    by === "item"
      ? Promise.resolve(null)
      : supabase.rpc("report_consumption", {
          p_from: from.toISOString(),
          p_to: to.toISOString(),
          p_group_by: "item",
        }),
  ]);

  const daily = (dailyRes.data ?? []) as unknown as DailyUsagePoint[];
  const consumption = (consumptionRes.data ?? []) as unknown as ConsumptionRow[];
  const itemConsumption =
    by === "item" ? consumption : ((itemRes?.data ?? []) as unknown as ConsumptionRow[]);
  const fastestMovers = itemConsumption.filter((r) => r.total_qty > 0).slice(0, 5);

  const loadError =
    dailyRes.error?.message ?? consumptionRes.error?.message ?? itemRes?.error?.message ?? null;

  // Fill quiet days with zeros so the area chart doesn't skip gaps.
  const byDayQty = new Map(daily.map((r) => [r.day, r.total_qty]));
  const filledDaily: DailyUsagePoint[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const day = sgtDay(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    filledDaily.push({ day, total_qty: byDayQty.get(day) ?? 0 });
  }

  const maxQty = Math.max(1, ...consumption.map((r) => r.total_qty));

  return (
    <>
      <PageHeader title="Reports" description="Consumption trends and who uses what">
        <ReportFilters range={range} by={by} />
      </PageHeader>

      {loadError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load report data: {friendlyError(loadError)}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="h-4 w-4 text-muted-foreground" />
            Daily checkout volume
          </CardTitle>
          <CardDescription>Total units checked out per day, last {range} days</CardDescription>
        </CardHeader>
        <CardContent>
          {daily.length === 0 ? (
            <EmptyState
              icon={LineChart}
              title="No checkouts in this period"
              description="Daily checkout volume will appear here once items start moving."
              className="border-0 bg-transparent py-10"
            />
          ) : (
            <DailyUsageChart data={filledDaily} />
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3">
            <h2 className="font-semibold leading-none tracking-tight">
              Consumption by {GROUP_LABELS[by]}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {by === "user"
                ? `Net units taken per person (checkouts minus returns), last ${range} days — who takes the most.`
                : `Net units consumed (checkouts minus returns), last ${range} days, highest first.`}
            </p>
          </div>
          {consumption.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="Nothing consumed in this period"
              description="Try a longer date range, or check back once checkouts come in."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead className="capitalize">{GROUP_LABELS[by]}</TableHead>
                  <TableHead>Net qty</TableHead>
                  <TableHead className="w-28 text-right">Transactions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consumption.map((row, i) => (
                  <TableRow key={row.group_key}>
                    <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="max-w-[16rem]">
                      <span className="block truncate font-medium" title={row.group_label}>
                        {row.group_label}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[10rem]">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{
                              width: `${Math.round((Math.max(0, row.total_qty) / maxQty) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right font-medium tabular-nums">
                          {row.total_qty}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {row.tx_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-muted-foreground" />
              Fastest movers
            </CardTitle>
            <CardDescription>Top 5 items by net consumption, last {range} days</CardDescription>
          </CardHeader>
          <CardContent>
            {fastestMovers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No item consumption in this period.
              </p>
            ) : (
              <ol className="space-y-3">
                {fastestMovers.map((row, i) => (
                  <li key={row.group_key} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm" title={row.group_label}>
                      {row.group_label}
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {row.total_qty}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
