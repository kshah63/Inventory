-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ reset_for_golive.sql  —  ONE-TIME go-live reset. RUN ONCE, BY HAND.
-- ╠══════════════════════════════════════════════════════════════════════════
-- ║ This is NOT a migration. It is never part of the numbered chain and must
-- ║ never be run automatically. Paste it into the Supabase SQL Editor and run
-- ║ it once, when you're ready to start the real stocktake.
-- ║
-- ║ IT IS IRREVERSIBLE. Take a backup first:
-- ║   Supabase dashboard → Database → Backups → create a snapshot/restore point.
-- ║ It all runs inside ONE transaction, so it either fully applies or not at
-- ║ all — but a backup is still the safety net.
-- ╚══════════════════════════════════════════════════════════════════════════
--
-- A clean slate for go-live: every bit of trial activity is wiped, leaving only
-- the setup you want to keep.
--
-- WIPED:
--   • Every item's stock count → 0, in every room (ready for the fresh count).
--   • Past stocktakes.
--   • The "interested" / "back in stock" tallies.
--   • All orders (and their lines); order numbering restarts, so the first
--     real order is #1.
--   • All new-item requests.
--   • All reimbursement claims (and their lines + receipt records).
--   • The whole stock ledger (every receive / checkout / transfer / adjustment
--     / stocktake movement) — reports start from a blank page.
--
-- KEPT:
--   • The catalogue — items, categories, variant groups, photos, aliases.
--   • Suppliers, locations (Level 8 / Basement), zones.
--   • Every user account and their four-digit User ID.
--
-- Note: receipt and request image FILES remain in Storage (harmless orphans).
-- Clear them under Storage → request-photos / receipts if you want them gone.

begin;

-- Stock counts → 0 everywhere. (A reduction, so no "back in stock" notice fires.)
update public.stock_levels set qty_on_hand = 0;

-- Trial activity (children cascade away with their parents).
truncate public.stocktakes       cascade;   -- + stocktake_lines
truncate public.item_interest;
truncate public.restock_notices;
truncate public.orders           cascade;   -- + order_lines
truncate public.requests;
truncate public.claims           cascade;   -- + claim_lines, claim_receipts
truncate public.transactions;                -- the stock ledger

-- First real order becomes #1.
alter table public.orders alter column order_no restart with 1;

commit;

-- Sanity check — every one of these should come back 0:
--   select coalesce(sum(qty_on_hand), 0) from public.stock_levels;
--   select count(*) from public.stocktakes;
--   select count(*) from public.orders;
--   select count(*) from public.requests;
--   select count(*) from public.claims;
--   select count(*) from public.transactions;
-- And the catalogue should be untouched:
--   select count(*) from public.items;
