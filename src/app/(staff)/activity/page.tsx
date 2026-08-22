import { redirect } from "next/navigation";

/** Activity lives inside Track my orders now — what you've collected is the
 * Collected tab, and it's the same cards you were already waiting on. */
export default function ActivityRedirect() {
  redirect("/orders?tab=collected");
}
