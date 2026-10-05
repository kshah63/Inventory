-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ reset_for_golive.sql  —  ONE-TIME go-live reset. RUN ONCE, BY HAND.
-- ╠══════════════════════════════════════════════════════════════════════════
-- ║ This is NOT a migration. It is never part of the numbered chain and must
-- ║ never be run automatically. Paste it into the Supabase SQL Editor and run
-- ║ it once, when you're ready to start the real stocktake.
-- ║
-- ║ IT IS IRREVERSIBLE. Take a backup first:
-- ║   Supabase dashboard → Database → Backups → create a snapshot/restore point.
-- ║ Everything below runs inside a transaction, so it either all applies or
-- ║ none of it does — but a backup is still the safety net.
-- ╚══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS RESETS (your chosen scope — "stock counts only"):
--   1. Every item's stock count → 0, in every room. Ready for the fresh count.
--   2. Past stocktakes → cleared.
--   3. The "interested" / "back in stock" tallies → cleared, so that loading
--      your real opening stock does NOT fire "back in stock" notices off
--      interest people tapped during the trial.
--
-- WHAT THIS KEEPS:
--   • The catalogue — items, categories, variant groups, photos, aliases.
--   • Suppliers, locations (Level 8 / Basement), zones.
--   • Every user account and their four-digit User ID.
--   • The full order / request / reimbursement history and the stock ledger.
--
-- Fresh "#1" order numbering is the OPTIONAL block at the very bottom — it
-- needs the trial orders cleared first, so it's kept separate. Leave it out to
-- keep every order and let numbering simply carry on from the last number used.

begin;

-- 1. Zero every stock count, in every room. (A reduction, so this does NOT
--    trigger any "back in stock" notice.)
update public.stock_levels set qty_on_hand = 0;

-- 2. Clear past stocktakes (their lines cascade away with them).
truncate public.stocktakes cascade;

-- 3. Clear the demand signals, so the first real restock is a clean slate and
--    doesn't notify people who tapped "interested" during the trial.
--    (Remove these two lines if you'd rather keep the existing interest list.)
truncate public.item_interest;
truncate public.restock_notices;

commit;

-- Sanity check — both of these should come back 0:
--   select coalesce(sum(qty_on_hand), 0) as units_on_hand from public.stock_levels;
--   select count(*) as stocktakes from public.stocktakes;


-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ OPTIONAL — make the first real order #1
-- ╠══════════════════════════════════════════════════════════════════════════
-- ║ Run this block ONLY if you also want the order numbering to restart at 1.
-- ║ It clears every trial ORDER and its lines (requests and reimbursement
-- ║ claims are left untouched) and restarts the counter. An identity counter
-- ║ can't restart under rows that already use those numbers, so the orders
-- ║ have to go first. Skip this block to keep order history, in which case new
-- ║ orders just continue from the last number used.
-- ║
-- ║ To run it, remove the leading "-- " from each line below.
-- ╚══════════════════════════════════════════════════════════════════════════
-- begin;
--   truncate public.orders cascade;   -- order_lines cascade away with them
--   alter table public.orders alter column order_no restart with 1;
-- commit;
