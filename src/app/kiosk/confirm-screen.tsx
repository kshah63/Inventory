"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CheckoutResult } from "@/lib/types";

const AUTO_FINISH_SECONDS = 6;

/** Post-checkout summary; auto-returns to the picker so the kiosk is never left signed in. */
export function ConfirmScreen({
  result,
  userName,
  onFinish,
}: {
  result: CheckoutResult;
  userName: string;
  onFinish: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = React.useState(AUTO_FINISH_SECONDS);
  const onFinishRef = React.useRef(onFinish);
  onFinishRef.current = onFinish;

  React.useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (secondsLeft <= 0) onFinishRef.current();
  }, [secondsLeft]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-10 text-center sm:px-6">
      <CheckCircle2 className="h-24 w-24 text-success" />
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
        All done{userName ? `, ${userName.split(/\s+/)[0]}` : ""}!
      </h1>

      <div className="mt-6 w-full rounded-lg border bg-card p-6 text-left shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          You took
        </p>
        <ul className="mt-3 space-y-2">
          {result.taken.map((line) => (
            <li key={line.item_id} className="flex items-baseline gap-3 text-xl">
              <span className="font-bold tabular-nums">{line.qty} ×</span>
              <span className="min-w-0 flex-1 truncate font-medium">{line.name}</span>
              <span className="text-base text-muted-foreground">{line.unit}</span>
            </li>
          ))}
        </ul>
      </div>

      {result.hit_zero.length > 0 && (
        <div className="mt-4 w-full rounded-lg border border-warning/40 bg-warning/10 p-4 text-left">
          {result.hit_zero.map((z) => (
            <p key={z.item_id} className="flex items-start gap-2 text-base">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <span>
                <span className="font-semibold">{z.name}</span> is now out of stock in {z.location}
                {z.elsewhere.length > 0 && (
                  <>
                    {" — "}
                    still {z.elsewhere.map((e) => `${e.qty} in ${e.location}`).join(", ")}
                  </>
                )}
                . The team has been alerted.
              </span>
            </p>
          ))}
        </div>
      )}

      <Button type="button" size="xl" className="mt-8 w-full sm:w-auto" onClick={onFinish}>
        Finish now ({Math.max(secondsLeft, 0)}s)
      </Button>
    </div>
  );
}
