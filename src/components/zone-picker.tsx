"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Where each zone physically sits, so the picker reads like the building.
 * Adjust here if the split changes.
 */
const SECTIONS: { heading: string; holds: (n: number) => boolean }[] = [
  { heading: "Level 8", holds: (n) => n >= 3 && n <= 14 },
  { heading: "Basement", holds: (n) => n >= 15 && n <= 22 },
];

/** One zone question, asked the same way on orders, requests and claims. */
export function ZonePicker({
  zones,
  value,
  onChange,
}: {
  zones: string[];
  value: string | null;
  onChange: (zone: string | null) => void;
}) {
  const grouped = SECTIONS.map((s) => ({
    heading: s.heading,
    zones: zones.filter((z) => {
      const n = parseInt(z, 10);
      return Number.isFinite(n) && s.holds(n);
    }),
  })).filter((g) => g.zones.length > 0);

  // A zone outside every range (a new one added in Settings, or a
  // non-numeric name) still has to be pickable, not silently dropped.
  const placed = new Set(grouped.flatMap((g) => g.zones));
  const other = zones.filter((z) => !placed.has(z));
  if (other.length > 0) grouped.push({ heading: "Other", zones: other });

  return (
    <div className="space-y-2.5">
      {grouped.map((group) => (
        <div key={group.heading}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.heading}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.zones.map((z) => (
              <button
                key={`${group.heading}-${z}`}
                type="button"
                onClick={() => onChange(value === z ? null : z)}
                aria-pressed={value === z}
                aria-label={`Zone ${z}, ${group.heading}`}
                className={cn(
                  "h-9 min-w-[2.75rem] rounded-full border px-3 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  value === z
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent"
                )}
              >
                {z}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
