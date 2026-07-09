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
  if (message === "SESSION_EXPIRED") return "Your kiosk session expired — please tap your name again.";
  if (message === "PIN_INVALID") return "Wrong PIN. Please try again.";
  if (message.startsWith("PIN_LOCKED:")) {
    const secs = message.split(":")[1];
    return `Too many attempts. Try again in ${secs} seconds.`;
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

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  ordered: "Ordered",
  fulfilled: "Fulfilled",
  rejected: "Rejected",
};
