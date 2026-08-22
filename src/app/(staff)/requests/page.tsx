import { redirect } from "next/navigation";

/** Requests are raised from the Order page and tracked in My supplies,
 * alongside everything else that was asked for. */
export default function RequestsRedirect() {
  redirect("/orders");
}
