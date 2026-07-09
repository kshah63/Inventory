"use client";

import * as React from "react";

/** Keeps the tablet screen awake while the kiosk is displayed
 * (Screen Wake Lock API; re-acquires on visibility change). */
export function useWakeLock() {
  React.useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Not supported / denied — kiosk OS-level settings keep the screen on.
      }
    }

    function onVisibility() {
      if (!cancelled && document.visibilityState === "visible") acquire();
    }

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
    };
  }, []);
}
