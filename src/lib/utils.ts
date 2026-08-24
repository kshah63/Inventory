import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SGT = "Asia/Singapore";

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SGT,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Cents to money. Everything to do with claims is stored and added up as
 * whole cents; this is the only place it becomes dollars, at the last
 * moment before somebody reads it. */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** "12.80" or "12" from a text field, back to whole cents. Returns null for
 * anything that isn't a positive amount. */
export function parseMoney(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 ? cents : null;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SGT,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SGT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Human-friendly relative time, e.g. "3h ago". */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** Map a raised Postgres error message to a friendly string. */
export function friendlyError(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Please try again.";

  // The app deploys the moment code is pushed; the database migrations are
  // run by hand afterwards. In the gap between the two, PostgREST answers
  // with its own wording — "in the schema cache", "column … does not
  // exist" — which reads like a crash to anyone who isn't holding the
  // migration list. Say what it actually is.
  if (
    /schema cache/i.test(message) ||
    /could not find the (function|table|column)/i.test(message) ||
    /(relation|column|function) .* does not exist/i.test(message)
  ) {
    return "This part of the app needs a database update that hasn't been run yet. Ask whoever deploys to run the latest migration in Supabase, then try again.";
  }

  return message;
}

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  checkout: "Checkout",
  return: "Return",
  receive: "Receive",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  adjustment: "Adjustment",
};

/** What procurement sees on the requests queue. */
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  ordered: "Ordered",
  received: "Received",
  ready: "Ready to collect",
  fulfilled: "Collected",
  rejected: "Rejected",
};

/** What the requester sees. "Received" deliberately reads as "on order":
 * stock landing in the store room isn't the same as it being packed and
 * ready for them, and a day or two sits in between. The expected date is
 * what they're told instead. */
export const REQUEST_STATUS_LABELS_REQUESTER: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  ordered: "On order",
  received: "On order",
  ready: "Ready to collect",
  fulfilled: "Collected",
  rejected: "Declined",
};
