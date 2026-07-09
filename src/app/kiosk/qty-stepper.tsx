"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Big − / number / + control sized for tablet fingers. */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max,
  unit,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const canDecrease = value > min;
  const canIncrease = max === undefined || value < max;

  return (
    <div className="flex items-center justify-center gap-5">
      <Button
        type="button"
        variant="outline"
        className="h-16 w-16 rounded-full [&_svg]:size-7"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={!canDecrease}
        aria-label="Decrease quantity"
      >
        <Minus />
      </Button>
      <div className="w-24 text-center">
        <div className="text-5xl font-bold tabular-nums leading-none">{value}</div>
        {unit && <div className="mt-1 text-sm text-muted-foreground">{unit}</div>}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-16 w-16 rounded-full [&_svg]:size-7"
        onClick={() => onChange(max === undefined ? value + 1 : Math.min(max, value + 1))}
        disabled={!canIncrease}
        aria-label="Increase quantity"
      >
        <Plus />
      </Button>
    </div>
  );
}
