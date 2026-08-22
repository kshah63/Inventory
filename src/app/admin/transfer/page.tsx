import { redirect } from "next/navigation";

/** Receiving, moving and recounting live together under Update stock. */
export default function TransferRedirect() {
  redirect("/admin/stock");
}
