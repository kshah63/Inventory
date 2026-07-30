import { cn } from "@/lib/utils";

/** The MathVision "MV" chevron mark — exact vector geometry and colors
 * (#F15A29 orange, #2E3192 blue) extracted from the official logo. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="18" fill="#F15A29" />
      <polygon
        fill="#2E3192"
        points="22.06,13.00 22.06,48.90 30.03,48.90 30.03,34.02 50.04,57.68 69.87,34.02 69.87,49.49 77.94,49.49 77.94,13.00 50.04,42.67"
      />
      <polygon
        fill="#FFFFFF"
        points="50.04,87.00 22.06,52.48 22.06,38.69 50.04,70.72 77.94,38.69 77.94,52.48"
      />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <LogoMark className="h-8 w-8 shrink-0" />
      {!compact && (
        <span className="text-lg font-bold leading-none tracking-tight">
          MathVision{" "}
          <span className="font-medium text-muted-foreground">Inventory</span>
        </span>
      )}
    </span>
  );
}
