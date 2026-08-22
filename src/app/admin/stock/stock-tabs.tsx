"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = "received" | "moved" | "recount";

/** Named by what happened, not by what the ledger calls it. Receiving,
 * transferring and adjusting were three sidebar entries for the same job —
 * change a number and say why — and the ledger type follows from the
 * answer rather than from which screen you found first. */
const LABELS: Record<TabKey, string> = {
  received: "Delivery arrived",
  moved: "Moved between rooms",
  recount: "Recount or breakage",
};

const BLURBS: Record<TabKey, string> = {
  received:
    "Pick the room it goes into, add what was on the packing list, and confirm.",
  moved:
    "Both sides are recorded as one linked movement, so the total never drifts.",
  recount:
    "For corrections and breakages. History is never edited — this adds a new entry, attributed to you, with your reason.",
};

export function StockTabs({
  received,
  moved,
  recount,
}: {
  received: React.ReactNode;
  moved: React.ReactNode;
  recount: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<TabKey>("received");
  const panels: Record<TabKey, React.ReactNode> = { received, moved, recount };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {(Object.keys(LABELS) as TabKey[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">{BLURBS[tab]}</p>
      {panels[tab]}
    </div>
  );
}
