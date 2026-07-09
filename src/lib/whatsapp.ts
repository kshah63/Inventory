import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * WhatsApp delivery via the Twilio Messages API (plain fetch, no SDK).
 *
 * Two send modes:
 *
 * 1. **Approved content templates** (production senders): WhatsApp only
 *    allows business-initiated messages outside a 24h reply window when they
 *    use a pre-approved template. Set TWILIO_CONTENT_SID_* env vars (one per
 *    message kind, see docs/DEPLOYMENT.md for the exact template bodies) and
 *    messages are sent as ContentSid + ContentVariables.
 * 2. **Freeform body** (sandbox, or inside a 24h session): used whenever no
 *    ContentSid is configured for that message kind.
 *
 * If Twilio env vars are missing entirely, sends are skipped gracefully and
 * logged as 'skipped' so the app never breaks without them.
 */

export type NotificationKind =
  | "digest"
  | "out_of_stock"
  | "approval_needed"
  | "approval_decided"
  | "request_update";

export interface WhatsAppMessage {
  /** Freeform text — sent as Body when no template is configured; always logged. */
  body: string;
  /** Template variables keyed "1".."5", matching the approved template for this kind. */
  variables?: Record<string, string>;
}

const CONTENT_SID_ENV: Record<NotificationKind, string> = {
  digest: "TWILIO_CONTENT_SID_DIGEST",
  out_of_stock: "TWILIO_CONTENT_SID_OUT_OF_STOCK",
  approval_needed: "TWILIO_CONTENT_SID_APPROVAL_NEEDED",
  approval_decided: "TWILIO_CONTENT_SID_APPROVAL_DECIDED",
  request_update: "TWILIO_CONTENT_SID_REQUEST_UPDATE",
};

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

/** Meta rejects template variables containing newlines/tabs or 4+ spaces;
 * empty variables are rejected too. */
function sanitizeVariable(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, 640);
  return cleaned.length > 0 ? cleaned : "-";
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
  message: WhatsAppMessage,
  kind: NotificationKind
): Promise<{ sent: boolean; error?: string }> {
  if (!twilioConfigured()) {
    await logNotification(to, kind, message.body, "skipped", "Twilio not configured");
    return { sent: false, error: "Twilio not configured" };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = normalizeWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM!);
  const contentSid = process.env[CONTENT_SID_ENV[kind]];

  const params = new URLSearchParams({
    From: from,
    To: normalizeWhatsAppAddress(to),
  });

  if (contentSid && message.variables) {
    // Approved template — deliverable outside the 24h session window.
    const sanitized = Object.fromEntries(
      Object.entries(message.variables).map(([k, v]) => [k, sanitizeVariable(v)])
    );
    params.set("ContentSid", contentSid);
    params.set("ContentVariables", JSON.stringify(sanitized));
  } else {
    // Freeform — works in the sandbox and inside 24h reply sessions.
    params.set("Body", message.body);
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      await logNotification(to, kind, message.body, "failed", detail.slice(0, 500));
      return { sent: false, error: detail };
    }

    await logNotification(to, kind, message.body, "sent");
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await logNotification(to, kind, message.body, "failed", msg);
    return { sent: false, error: msg };
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
export async function broadcastToProcurement(
  message: WhatsAppMessage,
  kind: NotificationKind
) {
  if (!(await alertsEnabled(kind === "digest" ? "digest_enabled" : "alerts_enabled"))) return;
  const recipients = await getAlertRecipients();
  await Promise.all(recipients.map((to) => sendWhatsApp(to, message, kind)));
}

function appLink(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : "";
}

// ── Message composers ──────────────────────────────────────────────────────
// Each returns both the freeform body and the {{n}} variables for the
// matching approved template (bodies documented in docs/DEPLOYMENT.md).

export function composeOutOfStockAlert(zeroItem: {
  name: string;
  location: string;
  elsewhere: { location: string; qty: number }[];
}): WhatsAppMessage {
  const elsewhereText =
    zeroItem.elsewhere.length > 0
      ? zeroItem.elsewhere.map((e) => `${e.qty} remain in ${e.location}`).join(", ")
      : "No stock in the other rooms";
  const link = appLink("/admin/reorder");
  return {
    body: `🔴 OUT OF STOCK: ${zeroItem.name} — ${zeroItem.location}. ${elsewhereText}.${link ? `\n${link}` : ""}`,
    variables: {
      "1": zeroItem.name,
      "2": zeroItem.location,
      "3": elsewhereText,
      "4": link || "-",
    },
  };
}

export function composeApprovalAlert(info: {
  requester_name: string;
  qty: number;
  unit: string;
  item_name: string;
  location_name: string;
}): WhatsAppMessage {
  const link = appLink("/admin/approvals");
  return {
    body: `🟡 Approval needed: ${info.requester_name} requests ${info.qty} × ${info.item_name} (${info.location_name}).${link ? `\nApprove: ${link}` : ""}`,
    variables: {
      "1": info.requester_name,
      "2": String(info.qty),
      "3": info.item_name,
      "4": info.location_name,
      "5": link || "-",
    },
  };
}

export function composeApprovalDecisionMessage(info: {
  status: string;
  qty: number;
  item_name: string;
  location_name: string;
  decision_note?: string | null;
}): WhatsAppMessage {
  const approved = info.status === "approved";
  const outcome = approved
    ? `approved — please collect from ${info.location_name}`
    : "not approved";
  const note = info.decision_note?.trim() || "-";
  return {
    body: approved
      ? `✅ Approved: your request for ${info.qty} × ${info.item_name} was approved. Please collect it from ${info.location_name}.`
      : `❌ Not approved: your request for ${info.qty} × ${info.item_name} (${info.location_name}) was rejected.${info.decision_note ? ` Note: ${info.decision_note}` : ""}`,
    variables: {
      "1": String(info.qty),
      "2": info.item_name,
      "3": outcome,
      "4": note,
    },
  };
}

export function composeRequestUpdateMessage(info: {
  item_label: string;
  qty: number;
  status: string;
  admin_note?: string | null;
}): WhatsAppMessage {
  const statusText: Record<string, string> = {
    acknowledged: "has been acknowledged",
    ordered: "has been ordered 🛒",
    fulfilled: "is ready — stock has arrived ✅",
    rejected: "was declined",
  };
  const statusPhrase = statusText[info.status] ?? `is now "${info.status}"`;
  const note = info.admin_note?.trim() || "-";
  return {
    body: `MathVision Stock: your request for ${info.qty} × ${info.item_label} ${statusPhrase}.${info.admin_note ? ` Note: ${info.admin_note}` : ""}`,
    variables: {
      "1": String(info.qty),
      "2": info.item_label,
      "3": statusPhrase,
      "4": note,
    },
  };
}

export function composeDigest(data: {
  low_stock: {
    item_name: string;
    unit: string;
    location_name: string;
    qty_on_hand: number;
  }[];
  open_requests: number;
  pending_approvals: number;
}): WhatsAppMessage {
  const link = appLink("/admin/reorder");

  const itemPhrase = (row: (typeof data.low_stock)[number]) => {
    const label = row.qty_on_hand === 0 ? "OUT" : `${row.qty_on_hand} ${row.unit} left`;
    return `${row.item_name} (${row.location_name}: ${label})`;
  };

  const shown = data.low_stock.slice(0, 15);
  const listText =
    shown.length > 0
      ? shown.map(itemPhrase).join("; ") +
        (data.low_stock.length > 15 ? `; and ${data.low_stock.length - 15} more` : "")
      : "none — all stock levels healthy";

  const bodyLines: string[] = [];
  bodyLines.push(
    data.low_stock.length > 0
      ? `📦 MathVision Stock — ${data.low_stock.length} item${data.low_stock.length === 1 ? "" : "s"} low:`
      : "📦 MathVision Stock — all stock levels healthy today."
  );
  for (const row of shown) bodyLines.push(`• ${itemPhrase(row)}`);
  if (data.low_stock.length > 15) bodyLines.push(`…and ${data.low_stock.length - 15} more.`);
  const extras: string[] = [];
  if (data.open_requests > 0)
    extras.push(`${data.open_requests} open request${data.open_requests === 1 ? "" : "s"}`);
  if (data.pending_approvals > 0)
    extras.push(
      `${data.pending_approvals} pending approval${data.pending_approvals === 1 ? "" : "s"}`
    );
  if (extras.length > 0) bodyLines.push(`+ ${extras.join(", ")}.`);
  if (link) bodyLines.push(`Open dashboard: ${link}`);

  return {
    body: bodyLines.join("\n"),
    variables: {
      "1": String(data.low_stock.length),
      "2": listText,
      "3": String(data.open_requests),
      "4": String(data.pending_approvals),
      "5": link || "-",
    },
  };
}
