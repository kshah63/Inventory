"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "waiting" | "collected";

const LABELS: Record<TabKey, string> = {
  waiting: "Waiting",
  collected: "Collected",
};

/** Two tabs, because there are only two questions: what am I still waiting
 * for, and what have I had? Orders and bought-in requests sit together in
 * both — the difference between them is ours to manage, not theirs. */
export function TrackingTabs({
  initialTab,
  waitingCount,
  waiting,
  collected,
}: {
  initialTab: TabKey;
  waitingCount: number;
  waiting: React.ReactNode;
  collected: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<TabKey>(initialTab);
  const panels: Record<TabKey, React.ReactNode> = { waiting, collected };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {(Object.keys(LABELS) as TabKey[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {LABELS[key]}
              {key === "waiting" && waitingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {waitingCount}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {panels[tab]}
    </div>
  );
}
