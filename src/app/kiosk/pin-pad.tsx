"use client";

import * as React from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn, friendlyError } from "@/lib/utils";
import { startKioskSession } from "@/lib/actions/kiosk";
import type { KioskSessionInfo } from "@/lib/types";
import type { KioskStaff } from "./kiosk-app";
import { initialsOf } from "./user-picker";

const MIN_PIN = 4;
const MAX_PIN = 6;

export function PinPad({
  staff,
  onCancel,
  onSuccess,
}: {
  staff: KioskStaff;
  onCancel: () => void;
  onSuccess: (session: KioskSessionInfo) => void;
}) {
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { toast } = useToast();

  const busyRef = React.useRef(busy);
  busyRef.current = busy;
  const pinRef = React.useRef(pin);
  pinRef.current = pin;

  const press = React.useCallback((digit: string) => {
    if (busyRef.current) return;
    setPin((p) => (p.length >= MAX_PIN ? p : p + digit));
  }, []);

  const backspace = React.useCallback(() => {
    if (busyRef.current) return;
    setPin((p) => p.slice(0, -1));
  }, []);

  const submit = React.useCallback(async () => {
    const current = pinRef.current;
    if (busyRef.current || current.length < MIN_PIN) return;
    setBusy(true);
    const result = await startKioskSession(staff.id, current);
    setBusy(false);
    setPin("");
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    onSuccess(result.data);
  }, [staff.id, toast, onSuccess]);

  // Physical keyboard support (handy for admin preview on a laptop).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") backspace();
      else if (e.key === "Enter") void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, backspace, submit]);

  const dots = Math.max(MIN_PIN, pin.length);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center px-4 py-8">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">
        {initialsOf(staff.full_name)}
      </span>
      <h1 className="mt-3 text-center text-2xl font-bold tracking-tight">{staff.full_name}</h1>
      <p className="mt-1 text-lg text-muted-foreground">Enter your PIN</p>

      <div className="mt-6 flex h-6 items-center gap-3" aria-label="PIN entry">
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-4 w-4 rounded-full border-2 transition-colors",
              i < pin.length ? "border-primary bg-primary" : "border-muted-foreground/40"
            )}
          />
        ))}
      </div>

      <div className="mt-6 grid w-full grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Button
            key={d}
            type="button"
            variant="outline"
            className="h-16 text-2xl font-semibold"
            onClick={() => press(d)}
            disabled={busy}
          >
            {d}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-16"
          onClick={backspace}
          disabled={busy || pin.length === 0}
          aria-label="Backspace"
        >
          <Delete className="!size-7" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-16 text-2xl font-semibold"
          onClick={() => press("0")}
          disabled={busy}
        >
          0
        </Button>
        <Button
          type="button"
          variant="success"
          className="h-16 text-xl font-bold"
          onClick={() => void submit()}
          disabled={pin.length < MIN_PIN}
          loading={busy}
        >
          GO
        </Button>
      </div>

      <Button type="button" variant="ghost" size="xl" className="mt-6 w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
