import { redirect } from "next/navigation";

/** Activity lives inside My orders now — same events, one place. */
export default function ActivityRedirect() {
  redirect("/orders?tab=activity");
}
