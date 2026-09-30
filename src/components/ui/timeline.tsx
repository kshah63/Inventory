import { cn, formatDate } from "@/lib/utils";

export interface TimelineStep {
  label: string;
  /** ISO date to show under the label, when we have one for this stage. */
  at?: string | null;
  state: "done" | "current" | "todo" | "cancelled";
}

/**
 * A compact vertical progress tracker for one order/request/claim — the
 * stages of its life, which one it's at, and the date each happened where we
 * recorded one. Vertical because these sit inside cards in a phone-width
 * list, where a horizontal stepper would crush four labels together.
 */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="mt-3">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border-2",
                  s.state === "done" && "border-primary bg-primary",
                  s.state === "current" && "border-primary bg-card ring-2 ring-primary/30",
                  s.state === "todo" && "border-muted-foreground/30 bg-card",
                  s.state === "cancelled" && "border-destructive bg-destructive"
                )}
              />
              {!last && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-px flex-1",
                    s.state === "done" ? "bg-primary/40" : "bg-border"
                  )}
                />
              )}
            </div>
            <div className={cn("min-w-0", last ? "pb-0" : "pb-3")}>
              <p
                className={cn(
                  "text-sm leading-none",
                  s.state === "current" && "font-semibold",
                  s.state === "todo" && "text-muted-foreground",
                  s.state === "cancelled" && "font-semibold text-destructive"
                )}
              >
                {s.label}
              </p>
              {s.at && (
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(s.at)}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
