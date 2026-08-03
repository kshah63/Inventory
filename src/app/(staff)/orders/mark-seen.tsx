"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { markOrdersSeen } from "@/lib/actions/orders";

/** Clears the unread marker once the page has actually been looked at.
 * Runs after the list renders, so the orders that changed still show their
 * "Updated" flag on this visit — they just won't on the next one. */
export function MarkOrdersSeen({ unread }: { unread: number }) {
  const router = useRouter();
  const done = React.useRef(false);

  React.useEffect(() => {
    if (unread === 0 || done.current) return;
    done.current = true;
    markOrdersSeen().then(() => router.refresh());
  }, [unread, router]);

  return null;
}
