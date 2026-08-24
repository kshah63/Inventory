"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "waiting" | "collected" | "claims";

const LABELS: Record<TabKey, string> = {
  waiting: "Waiting",
  collected: "Collected",
  // Money, not goods — which is why it's a tab of its own rather than more
  // cards in the other two. It's the one place a running total makes sense.
  claims: "Reimbursements",
};

/** What am I still waiting for, what have I had, and what am I owed.
 * Orders and bought-in requests sit together in the first two — the
 * difference between them is ours to manage, not theirs. */
export function TrackingTabs({
  initialTab,
  waitingCount,
  claimsCount,
  waiting,
  collected,
  claims,
}: {
  initialTab: TabKey;
  waitingCount: number;
  claimsCount: number;
  waiting: React.ReactNode;
  collected: React.ReactNode;
  claims: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<TabKey>(initialTab);
  const panels: Record<TabKey, React.ReactNode> = { waiting, collected, claims };
  const counts: Partial<Record<TabKey, number>> = {
    waiting: waitingCount,
    claims: claimsCount,
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {(Object.keys(LABELS) as TabKey[]).map((key) => {
            const count = counts[key] ?? 0;
            return (
              <TabsTrigger key={key} value={key}>
                {LABELS[key]}
                {count > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {panels[tab]}
    </div>
  );
}
