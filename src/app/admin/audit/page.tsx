import Link from "next/link";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDateTime, friendlyError, TRANSACTION_TYPE_LABELS } from "@/lib/utils";
import type { Location, StaffDirectoryEntry, TransactionRow, TransactionType } from "@/lib/types";
import { AuditFilters, type AuditFilterValues } from "./audit-filters";
import { ExportCsvButton } from "./export-csv-button";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TYPE_BADGE: Record<
  TransactionType,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  checkout: "default",
  return: "success",
  receive: "success",
  transfer_out: "secondary",
  transfer_in: "secondary",
  adjustment: "warning",
};

function param(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
}

function pageHref(filters: AuditFilterValues, page: number): string {
  const params = new URLSearchParams();
  (["type", "location", "user", "q", "from", "to"] as const).forEach((key) => {
    if (filters[key]) params.set(key, filters[key]);
  });
  if (page > 0) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/audit?${qs}` : "/admin/audit";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const typeParam = param(sp.type);
  const filters: AuditFilterValues = {
    type: typeParam in TRANSACTION_TYPE_LABELS ? typeParam : "",
    location: param(sp.location),
    user: param(sp.user),
    q: param(sp.q).trim(),
    from: DATE_RE.test(param(sp.from)) ? param(sp.from) : "",
    to: DATE_RE.test(param(sp.to)) ? param(sp.to) : "",
  };
  const pageParsed = parseInt(param(sp.page), 10);
  const page = Number.isFinite(pageParsed) && pageParsed > 0 ? pageParsed : 0;

  const supabase = await createClient();

  let query = supabase
    .from("v_transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.location) query = query.eq("location_id", filters.location);
  if (filters.user) query = query.eq("user_id", filters.user);
  if (filters.q) query = query.ilike("item_name", `%${filters.q}%`);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to + "T23:59:59");

  const [txRes, locRes, staffRes] = await Promise.all([
    query,
    supabase.from("locations").select("id, name, is_active").eq("is_active", true).order("name"),
    supabase
      .from("staff_directory")
      .select("id, full_name, department, role, is_active")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const rows = (txRes.data ?? []) as unknown as TransactionRow[];
  const locations = (locRes.data ?? []) as unknown as Location[];
  const staff = (staffRes.data ?? []) as unknown as StaffDirectoryEntry[];
  const loadError = txRes.error?.message ?? locRes.error?.message ?? staffRes.error?.message ?? null;

  const hasFilters = Object.values(filters).some(Boolean);
  const hasPrev = page > 0;
  const hasNext = rows.length === PAGE_SIZE;

  return (
    <>
      <PageHeader title="Audit log" description="Every stock movement, newest first">
        <ExportCsvButton rows={rows} page={page} />
      </PageHeader>

      {loadError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load the ledger: {friendlyError(loadError)}
        </p>
      )}

      <AuditFilters filters={filters} locations={locations} staff={staff} />

      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={hasFilters || page > 0 ? "No transactions match" : "No transactions yet"}
          description={
            hasFilters || page > 0
              ? "Try widening the date range or clearing some filters."
              : "Stock movements will appear here as soon as they happen."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(t.created_at)}
                </TableCell>
                <TableCell>
                  <Badge variant={TYPE_BADGE[t.type]} className="whitespace-nowrap">
                    {TRANSACTION_TYPE_LABELS[t.type] ?? t.type}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  <span className="block truncate font-medium" title={t.item_name}>
                    {t.item_name}
                  </span>
                  <span className="block text-xs text-muted-foreground">{t.sku}</span>
                </TableCell>
                <TableCell
                  className={cn(
                    "whitespace-nowrap text-right font-medium tabular-nums",
                    t.qty_delta > 0 && "text-success",
                    t.qty_delta < 0 && "text-destructive"
                  )}
                >
                  {t.qty_delta > 0 ? `+${t.qty_delta}` : t.qty_delta}{" "}
                  <span className="text-xs font-normal text-muted-foreground">{t.unit}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{t.location_name}</TableCell>
                <TableCell className="max-w-[11rem]">
                  <span className="block truncate" title={t.user_name}>
                    {t.user_name}
                  </span>
                  {t.on_behalf_of_name && (
                    <span
                      className="block truncate text-xs text-muted-foreground"
                      title={`by ${t.on_behalf_of_name}`}
                    >
                      by {t.on_behalf_of_name}
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  {t.note ? (
                    <span className="block truncate text-muted-foreground" title={t.note}>
                      {t.note}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {(rows.length > 0 || page > 0) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {rows.length > 0 ? (
              <>
                Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length}
              </>
            ) : (
              <>Page {page + 1}</>
            )}
          </p>
          <div className="flex items-center gap-2">
            {hasPrev ? (
              <Link
                href={pageHref(filters, page - 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <ChevronLeft /> Previous
              </Link>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <ChevronLeft /> Previous
              </Button>
            )}
            {hasNext ? (
              <Link
                href={pageHref(filters, page + 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Next <ChevronRight />
              </Link>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Next <ChevronRight />
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
