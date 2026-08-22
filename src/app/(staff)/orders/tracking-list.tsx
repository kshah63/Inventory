"use client";

import * as React from "react";
import Link from "next/link";
import { PackageCheck, ShoppingBag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderCard, type StaffOrder } from "./order-card";
import { RequestCard, type RequestWithJoins } from "./request-card";

/**
 * One list, whether we had it on the shelf or had to buy it in. Which of the
 * two it was is our filing rule, not the requester's — they asked for a
 * thing and want to know where it's got to. The card says which kind it is;
 * it is never somewhere you have to go and look.
 */
export function TrackingList({
  orders,
  requests,
  updatedIds = [],
  variant,
}: {
  orders: StaffOrder[];
  requests: RequestWithJoins[];
  /** Orders that moved on since this person last looked. */
  updatedIds?: string[];
  /** "waiting" — still in flight. "collected" — finished with. */
  variant: "waiting" | "collected";
}) {
  const updated = React.useMemo(() => new Set(updatedIds), [updatedIds]);

  const entries = React.useMemo(() => {
    const rows: {
      key: string;
      at: string;
      /** Ready to collect sorts to the top: it's the only one that needs them. */
      needsThem: boolean;
      node: React.ReactNode;
    }[] = [
      ...orders.map((o) => ({
        key: `o-${o.id}`,
        at: o.created_at,
        needsThem: o.status === "ready",
        node: <OrderCard order={o} updated={updated.has(o.id)} />,
      })),
      ...requests.map((r) => ({
        key: `r-${r.id}`,
        at: r.created_at,
        needsThem: r.status === "ready",
        node: <RequestCard request={r} />,
      })),
    ];
    return rows.sort((a, b) => {
      if (a.needsThem !== b.needsThem) return a.needsThem ? -1 : 1;
      return b.at.localeCompare(a.at);
    });
  }, [orders, requests, updated]);

  if (entries.length === 0) {
    return variant === "waiting" ? (
      <EmptyState
        icon={ShoppingBag}
        title="Nothing on the way"
        description="Order supplies from the catalogue and they'll show up here. If we don't stock what you need, ask for it there too."
      >
        <Link href="/browse" className={buttonVariants({})}>
          Browse the catalogue
        </Link>
      </EmptyState>
    ) : (
      <EmptyState
        icon={PackageCheck}
        title="Nothing collected yet"
        description="Once you've picked something up it moves here, so you can see what you've had."
      />
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <React.Fragment key={e.key}>{e.node}</React.Fragment>
      ))}
    </div>
  );
}
