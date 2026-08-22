import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardCheck,
  History,
  Inbox,
  PackageCheck,
  PackageOpen,
  PackageX,
  ShoppingCart,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, friendlyError, timeAgo, TRANSACTION_TYPE_LABELS } from "@/lib/utils";
import type { DashboardStats, TransactionRow, TransactionType } from "@/lib/types";
import { ResetRequestsPanel, type ResetRequest } from "./reset-requests-panel";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const EMPTY_STATS: DashboardStats = {
  low_stock: 0,
  out_of_stock: 0,
  open_requests: 0,
  ordered_requests: 0,
  pending_orders: 0,
  ready_orders: 0,
  requests_to_hand_over: 0,
  reset_requests: 0,
  checkouts_today: 0,
  top_movers_week: [],
};

const TYPE_BADGE: Record<
  TransactionType,
  "default" | "secondary" | "outline" | "success" | "warning"
> = {
  checkout: "default",
  return: "secondary",
  receive: "success",
  transfer_out: "outline",
  transfer_in: "outline",
  adjustment: "warning",
};

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const [statsRes, txRes, resetRes] = await Promise.all([
    supabase.rpc("get_dashboard_stats"),
    supabase
      .from("v_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
    // Two plain queries rather than an embedded join: the join names a
    // foreign-key constraint, and there are two of them from this table to
    // users, so a rename or a stale schema cache silently empties the queue.
    supabase
      .from("password_reset_requests")
      .select("id, identifier, created_at, matched_user")
      .eq("status", "open")
      .order("created_at"),
  ]);

  const stats = (statsRes.data as unknown as DashboardStats) ?? EMPTY_STATS;
  const recent = (txRes.data ?? []) as unknown as TransactionRow[];

  const resetRows = (resetRes.data ?? []) as unknown as {
    id: string;
    identifier: string;
    created_at: string;
    matched_user: string | null;
  }[];
  const matchedIds = [...new Set(resetRows.map((r) => r.matched_user).filter(Boolean))];
  const peopleRes = matchedIds.length
    ? await supabase
        .from("users")
        .select("id, full_name, user_no, role")
        .in("id", matchedIds as string[])
    : null;
  const peopleById = new Map(
    ((peopleRes?.data ?? []) as unknown as {
      id: string;
      full_name: string;
      user_no: number | null;
      role: string;
    }[]).map((u) => [u.id, u])
  );
  const resetRequests: ResetRequest[] = resetRows.map((r) => ({
    id: r.id,
    identifier: r.identifier,
    created_at: r.created_at,
    matched: r.matched_user ? peopleById.get(r.matched_user) ?? null : null,
  }));

  // The reset panel renders nothing when the queue is empty, so a broken
  // query looks exactly like "no requests" — surface it here instead.
  const loadError =
    statsRes.error?.message ??
    txRes.error?.message ??
    resetRes.error?.message ??
    peopleRes?.error?.message ??
    null;
  const maxMoverQty = Math.max(1, ...stats.top_movers_week.map((m) => m.qty));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Stock health across Level 8 and Basement"
      >
        <Link href="/admin/receive" className={buttonVariants({ variant: "outline" })}>
          <Truck /> Receive stock
        </Link>
        <Link href="/admin/transfer" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeftRight /> Transfer
        </Link>
        <Link href="/admin/stocktake" className={buttonVariants({ variant: "outline" })}>
          <ClipboardCheck /> Stocktake
        </Link>
      </PageHeader>

      {loadError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load some dashboard data: {friendlyError(loadError)}
        </p>
      )}

      {/* The count comes from a different query to the list. When they
          disagree, someone is waiting on a password and the queue can't
          show them — say so rather than look empty. */}
      {stats.reset_requests > 0 && resetRequests.length === 0 && (
        <p className="mb-6 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          {stats.reset_requests} password reset request
          {stats.reset_requests === 1 ? " is" : "s are"} waiting, but the queue
          couldn&apos;t be read. You can still set a new password from{" "}
          <Link href="/admin/users" className="font-medium underline">
            Users
          </Link>{" "}
          → Edit → Reset password.
        </p>
      )}

      <ResetRequestsPanel requests={resetRequests} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Orders to pack"
          value={stats.pending_orders ?? 0}
          sub="pre-orders waiting"
          icon={PackageOpen}
          href="/admin/orders"
          tone={(stats.pending_orders ?? 0) > 0 ? "warning" : undefined}
        />
        <StatCard
          label="Awaiting collection"
          value={stats.ready_orders ?? 0}
          sub="packed, not picked up"
          icon={PackageCheck}
          href="/admin/orders"
        />
        <StatCard
          label="Low stock"
          value={stats.low_stock}
          sub="at or below the reorder level"
          icon={AlertTriangle}
          href="/admin/inventory?stock=low"
          tone={stats.low_stock > 0 ? "warning" : undefined}
        />
        <StatCard
          label="Out of stock"
          value={stats.out_of_stock}
          sub="items at zero"
          icon={PackageX}
          href="/admin/inventory?stock=out"
          tone={stats.out_of_stock > 0 ? "destructive" : undefined}
        />
        <StatCard
          label="Open requests"
          value={stats.open_requests}
          sub="awaiting a response"
          icon={Inbox}
          href="/admin/requests"
        />
        <StatCard
          label="On order"
          value={stats.ordered_requests ?? 0}
          sub="awaiting delivery"
          icon={Truck}
          href="/admin/requests"
        />
        <StatCard
          label="Checkouts today"
          value={stats.checkouts_today}
          sub="units taken"
          icon={ShoppingCart}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Top movers this week
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.top_movers_week.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No checkouts in the past 7 days.
              </p>
            ) : (
              <div className="space-y-4">
                {stats.top_movers_week.map((m) => (
                  <div key={m.name}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">{m.name}</span>
                      <span className="font-medium tabular-nums">{m.qty}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.round((m.qty / maxMoverQty) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No stock movements yet.
              </p>
            ) : (
              <ul className="divide-y">
                {recent.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <Badge
                      variant={TYPE_BADGE[t.type]}
                      className="w-[5.5rem] shrink-0 justify-center"
                    >
                      {TRANSACTION_TYPE_LABELS[t.type]}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.item_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.user_name}
                        {t.on_behalf_of_name ? ` for ${t.on_behalf_of_name}` : ""}
                        {" · "}
                        {t.location_name}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {t.qty_delta > 0 ? `+${t.qty_delta}` : t.qty_delta} {t.unit}
                    </span>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                      {timeAgo(t.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  href,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  icon: LucideIcon;
  href?: string;
  tone?: "warning" | "destructive";
}) {
  const card = (
    <Card
      className={cn(
        "h-full",
        tone === "warning" && "border-warning/60 bg-warning/10",
        tone === "destructive" && "border-destructive/60 bg-destructive/10",
        href && "transition-colors hover:border-primary/50"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Icon
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground/60",
              tone === "warning" && "text-warning",
              tone === "destructive" && "text-destructive"
            )}
          />
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Link>
  ) : (
    card
  );
}
