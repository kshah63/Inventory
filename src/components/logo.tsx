import { cn } from "@/lib/utils";

/** MathVision wordmark — navy square with a sigma-inspired mark. */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
        M
      </span>
      {!compact && (
        <span className="font-semibold tracking-tight">
          MathVision <span className="font-normal text-muted-foreground">Stock</span>
        </span>
      )}
    </span>
  );
}
