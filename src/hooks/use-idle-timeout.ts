"use client";

import * as React from "react";

/**
 * Fires `onIdle` after `seconds` of no pointer/keyboard/touch activity.
 * Used by the kiosk to auto-return to the user picker (45s per spec).
 */
export function useIdleTimeout(onIdle: () => void, seconds: number, active: boolean) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = React.useRef(onIdle);
  onIdleRef.current = onIdle;

  React.useEffect(() => {
    if (!active) return;

    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onIdleRef.current(), seconds * 1000);
    };

    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [seconds, active]);
}
