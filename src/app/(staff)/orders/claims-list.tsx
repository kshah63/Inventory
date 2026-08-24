"use client";

import * as React from "react";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";
import { ClaimCard, claimTotal } from "./claim-card";
import type { ClaimWithLines } from "@/lib/types";

/** Your own claims, newest first, with what you're still owed at the top —
 * the one number anybody actually opens this tab for. */
export function ClaimsList({ claims }: { claims: ClaimWithLines[] }) {
  const owed = claims
    .filter((c) => c.status === "requested")
    .reduce((n, c) => n + claimTotal(c), 0);

  if (claims.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No claims yet"
        description="If you buy something for the centre out of your own pocket, claim it back from the Order page."
      />
    );
  }

  return (
    <div className="space-y-3">
      {owed > 0 && (
        <div className="flex items-baseline justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            Waiting to be paid back to you
          </span>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(owed)}
          </span>
        </div>
      )}
      {claims.map((c) => (
        <ClaimCard key={c.id} claim={c} />
      ))}
    </div>
  );
}
