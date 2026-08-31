// Shared domain types mirroring the Supabase schema (supabase/migrations/0001_init.sql).

export type Role = "super_admin" | "procurement" | "staff" | "dept_head" | "kiosk";

export type TransactionType =
  | "checkout"
  | "return"
  | "receive"
  | "transfer_out"
  | "transfer_in"
  | "adjustment";

export type RequestStatus =
  | "open"
  | "acknowledged"
  | "ordered"
  /** Arrived with us, not yet packed. Never shown to the requester as such. */
  | "received"
  | "ready"
  | "fulfilled"
  | "rejected";

export type OrderStatus = "pending" | "ready" | "collected" | "rejected" | "cancelled";

/** Somebody bought it themselves and wants the money back. Two states plus
 * a refusal — the person who checks the claim is the person who pays it. */
export type ClaimStatus = "requested" | "paid" | "declined";

export interface Location {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export interface Item {
  id: string;
  sku: string;
  name: string;
  category_id: string;
  unit: string;
  pack_size: number | null;
  photo_url: string | null;
  notes: string | null;
  max_per_checkout: number | null;
  /** Roughly how many we like to have, across every room. Null means nobody
   * is tracking it, so it never appears on Reorder. */
  keep_about: number | null;
  /** Central team only — heavy cleaning supplies and the like. Hidden from
   * everyone else by the read policy, not just by the app. */
  admin_only: boolean;
  is_active: boolean;
  created_at: string;
}

export interface StockLevel {
  item_id: string;
  location_id: string;
  qty_on_hand: number;
}

export interface UserProfile {
  id: string;
  full_name: string;
  role: Role;
  user_no: number | null;
  department: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface StaffDirectoryEntry {
  id: string;
  full_name: string;
  department: string | null;
  role: Role;
  is_active: boolean;
  user_no: number | null;
}

export interface TransactionRow {
  id: string;
  type: TransactionType;
  qty_delta: number;
  zone: string | null;
  note: string | null;
  transfer_group: string | null;
  created_at: string;
  item_id: string;
  sku: string;
  item_name: string;
  unit: string;
  location_id: string;
  location_name: string;
  user_id: string;
  user_name: string;
  on_behalf_of: string | null;
  on_behalf_of_name: string | null;
  category_name: string;
}

export interface RequestRow {
  id: string;
  requested_by: string;
  item_id: string | null;
  free_text_item: string | null;
  description: string | null;
  product_url: string | null;
  photo_url: string | null;
  qty: number;
  location_id: string | null;
  zone: string | null;
  status: RequestStatus;
  note: string | null;
  admin_note: string | null;
  fulfilled_item_id: string | null;
  expected_date: string | null;
  /** When it reached us from the supplier. */
  received_at: string | null;
  /** When the requester picked it up. */
  collected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReorderRow {
  item_id: string;
  sku: string;
  item_name: string;
  category_name: string;
  unit: string;
  /** Totalled across every room it's kept in. */
  qty_on_hand: number;
  keep_about: number;
  suggested_qty: number;
  avg_daily_use: number;
  days_to_stockout: number | null;
}

export interface DashboardStats {
  low_stock: number;
  out_of_stock: number;
  open_requests: number;
  ordered_requests: number;
  pending_orders: number;
  ready_orders: number;
  requests_to_hand_over: number;
  reset_requests: number;
  checkouts_today: number;
  top_movers_week: { name: string; qty: number }[];
}

export interface OrderRow {
  id: string;
  order_no: number;
  requested_by: string;
  location_id: string;
  zone: string | null;
  status: OrderStatus;
  note: string | null;
  admin_note: string | null;
  packed_by: string | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  collected_at: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  seen_at: string | null;
}

export interface OrderLineRow {
  order_id: string;
  item_id: string;
  qty_requested: number;
  qty_packed: number | null;
}

export interface ConsumptionRow {
  group_key: string;
  group_label: string;
  total_qty: number;
  tx_count: number;
}

export interface BasketLine {
  item_id: string;
  qty: number;
}

// Item joined with its stock rows — the shape used by browse/catalog screens.
export interface CatalogItem extends Item {
  category: { name: string } | null;
  stock_levels: { location_id: string; qty_on_hand: number }[];
}

/** A catalogue item that looks like what someone is asking for. */
export interface CatalogueMatch {
  item_id: string;
  sku: string;
  name: string;
  unit: string;
  qty_on_hand: number;
  max_per_order: number | null;
  matched_alias: string | null;
  score: number;
}

export interface ClaimLineRow {
  id: string;
  claim_id: string;
  description: string;
  /** Whole cents. Never a float — decimal money drifts. */
  amount_cents: number;
  sort_order: number;
}

export interface ClaimReceiptRow {
  id: string;
  claim_id: string;
  /** Path inside the private bucket. There is no public URL; the app signs
   * a short-lived one when somebody with permission asks to look. */
  path: string;
  file_name: string | null;
  uploaded_at: string;
}

export interface ClaimRow {
  id: string;
  claimed_by: string;
  zone: string | null;
  /** Why it wasn't ordered the usual way. Required, and the whole point:
   * repeated answers here are a stocking failure we can act on. */
  reason: string;
  status: ClaimStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface ClaimWithLines extends ClaimRow {
  claim_lines: ClaimLineRow[];
  claim_receipts: ClaimReceiptRow[];
}

// ── The supplier register (portal is the master; QuickBooks follows) ──────

export interface SupplierGroup {
  code: number;
  name: string;
}

export interface SupplierSubgroup {
  id: string;
  group_code: number;
  /** The block: code_start is the header and is never a supplier. */
  code_start: number;
  code_end: number;
  name: string;
}

export interface SupplierAliasRow {
  id: string;
  alias: string;
  old_code: string | null;
}

export interface SupplierRow {
  id: string;
  subgroup_id: string;
  group_code: number;
  sub_code: number;
  name: string;
  status: "active" | "retired";
  notes: string | null;
  supplier_aliases: SupplierAliasRow[];
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
