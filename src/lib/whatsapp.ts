import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * WhatsApp delivery via the Twilio Messages API.
 *
 * Uses plain `fetch` with HTTP basic auth — no SDK needed. Works with the
 * Twilio WhatsApp Sandbox out of the box (recipients join the sandbox once),
 * and with an approved production WhatsApp sender later. If Twilio env vars
 * are not configured, sends are skipped gracefully and logged as 'skipped'
 * so the app never breaks without them.
 */

export type NotificationKind =
  | "digest"
  | "out_of_stock"
  | "approval_needed"
  | "approval_decided"
  | "request_update";

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
  );
}

function normalizeWhatsAppAddress(phone: string): string {
  const trimmed = phone.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

async function logNotification(
  recipient: string,
  kind: NotificationKind,
  body: string,
  status: "sent" | "failed" | "skipped",
  error?: string
) {
  try {
    const admin = createAdminClient();
    await admin.from("notifications_log").insert({
      channel: "whatsapp",
      recipient,
      kind,
      body,
      status,
      error: error ?? null,
    });
  } catch {
    // Logging must never break the main flow (e.g. service key not set).
  }
}

/** Send one WhatsApp message. Never throws. */
export async function sendWhatsApp(
  to: string,
  body: string,
  kind: NotificationKind
): Promise<{ sent: boolean; error?: string }> {
  if (!twilioConfigured()) {
    await logNotification(to, kind, body, "skipped", "Twilio not configured");
    return { sent: false, error: "Twilio not configured" };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = normalizeWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM!);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: from,
          To: normalizeWhatsAppAddress(to),
          Body: body,
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      await logNotification(to, kind, body, "failed", detail.slice(0, 500));
      return { sent: false, error: detail };
    }

    await logNotification(to, kind, body, "sent");
    return { sent: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await logNotification(to, kind, body, "failed", message);
    return { sent: false, error: message };
  }
}

/** Configured procurement-team recipient numbers from the settings table. */
export async function getAlertRecipients(): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("settings")
      .select("value")
      .eq("key", "whatsapp_recipients")
      .single();
    if (Array.isArray(data?.value)) {
      return (data.value as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0
      );
    }
  } catch {
    // fall through
  }
  return [];
}

async function alertsEnabled(key: "alerts_enabled" | "digest_enabled"): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("settings").select("value").eq("key", key).single();
    return data?.value !== false;
  } catch {
    return true;
  }
}

/** Broadcast one message to every configured procurement recipient. */
export async function broadcastToProcurement(body: string, kind: NotificationKind) {
  if (!(await alertsEnabled(kind === "digest" ? "digest_enabled" : "alerts_enabled"))) return;
  const recipients = await getAlertRecipients();
  await Promise.all(recipients.map((to) => sendWhatsApp(to, body, kind)));
}

function appLink(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : "";
}

// ── Message composers ──────────────────────────────────────────────────────

export function composeOutOfStockAlert(zeroItem: {
  name: string;
  location: string;
  elsewhere: { location: string; qty: number }[];
}): string {
  const elsewhere =
    zeroItem.elsewhere.length > 0
      ? ` ${zeroItem.elsewhere.map((e) => `${e.qty} remain in ${e.location}`).join(", ")}.`
      : " None available in other rooms.";
  const link = appLink("/admin/reorder");
  return `🔴 OUT OF STOCK: ${zeroItem.name} — ${zeroItem.location}.${elsewhere}${link ? `\n${link}` : ""}`;
}

export function composeApprovalAlert(info: {
  requester_name: string;
  qty: number;
  unit: string;
  item_name: string;
  location_name: string;
}): string {
  const link = appLink("/admin/approvals");
  return `🟡 Approval needed: ${info.requester_name} requests ${info.qty} × ${info.item_name} (${info.location_name}).${link ? `\nApprove: ${link}` : ""}`;
}

export function composeApprovalDecisionMessage(info: {
  status: string;
  qty: number;
  item_name: string;
  location_name: string;
  decision_note?: string | null;
}): string {
  if (info.status === "approved") {
    return `✅ Approved: your request for ${info.qty} × ${info.item_name} was approved. Please collect it from ${info.location_name}.`;
  }
  return `❌ Not approved: your request for ${info.qty} × ${info.item_name} (${info.location_name}) was rejected.${info.decision_note ? ` Note: ${info.decision_note}` : ""}`;
}

export function composeRequestUpdateMessage(info: {
  item_label: string;
  qty: number;
  status: string;
  admin_note?: string | null;
}): string {
  const statusText: Record<string, string> = {
    acknowledged: "has been acknowledged",
    ordered: "has been ordered 🛒",
    fulfilled: "is ready — stock has arrived ✅",
    rejected: "was declined",
  };
  return `MathVision Stock: your request for ${info.qty} × ${info.item_label} ${statusText[info.status] ?? `is now "${info.status}"`}.${info.admin_note ? ` Note: ${info.admin_note}` : ""}`;
}

export function composeDigest(data: {
  low_stock: {
    item_name: string;
    location_name: string;
    qty_on_hand: number;
    unit: string;
  }[];
  open_requests: number;
  pending_approvals: number;
}): string {
  const lines: string[] = [];
  const header =
    data.low_stock.length > 0
      ? `📦 MathVision Stock — ${data.low_stock.length} item${data.low_stock.length === 1 ? "" : "s"} low:`
      : "📦 MathVision Stock — all stock levels healthy today.";
  lines.push(header);

  for (const row of data.low_stock.slice(0, 15)) {
    const label = row.qty_on_hand === 0 ? "OUT" : `${row.qty_on_hand} ${row.unit} left`;
    lines.push(`• ${row.item_name} (${row.location_name}: ${label})`);
  }
  if (data.low_stock.length > 15) {
    lines.push(`…and ${data.low_stock.length - 15} more.`);
  }

  const extras: string[] = [];
  if (data.open_requests > 0) extras.push(`${data.open_requests} open request${data.open_requests === 1 ? "" : "s"}`);
  if (data.pending_approvals > 0) extras.push(`${data.pending_approvals} pending approval${data.pending_approvals === 1 ? "" : "s"}`);
  if (extras.length > 0) lines.push(`+ ${extras.join(", ")}.`);

  const link = appLink("/admin/reorder");
  if (link) lines.push(`Open dashboard: ${link}`);
  return lines.join("\n");
}
