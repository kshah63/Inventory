"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "orders" | "requests" | "activity";

const LABELS: Record<TabKey, string> = {
  orders: "Orders",
  requests: "Requests",
  activity: "Collected",
};

/** Orders, requests and what actually arrived, in one place — they're three
 * views of the same question: where has my stuff got to? */
export function OrdersTabs({
  initialTab,
  counts,
  orders,
  requests,
  activity,
}: {
  initialTab: TabKey;
  counts: { orders: number; requests: number };
  orders: React.ReactNode;
  requests: React.ReactNode;
  activity: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<TabKey>(initialTab);
  const panels: Record<TabKey, React.ReactNode> = { orders, requests, activity };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {(Object.keys(LABELS) as TabKey[]).map((key) => {
            const count = key === "activity" ? 0 : counts[key];
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
