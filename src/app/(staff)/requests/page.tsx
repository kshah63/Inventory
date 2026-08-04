import { redirect } from "next/navigation";

/** Requests are raised from the Order page and tracked in My orders. */
export default function RequestsRedirect() {
  redirect("/orders?tab=requests");
}
