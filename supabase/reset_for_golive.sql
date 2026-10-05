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
-- WHAT THIS RESETS:
--   1. Every item's stock count → 0, in every room. Ready for the fresh count.
--   2. Past stocktakes → cleared.
--   3. The "interested" / "back in stock" tallies → cleared, so that loading
--      your real opening stock does NOT fire "back in stock" notices off
--      interest people tapped during the trial.
--   4. All trial ORDERS (and their lines) → cleared, and order numbering
--      restarts so the first real order is #1.
--
-- WHAT THIS KEEPS:
--   • The catalogue — items, categories, variant groups, photos, aliases.
--   • Suppliers, locations (Level 8 / Basement), zones.
--   • Every user account and their four-digit User ID.
--   • New-item requests, reimbursement claims, and the stock ledger — UNLESS
--     you also run the optional blocks at the bottom (recommended if those
--     were all testing too).

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

-- 4. Clear the trial orders (lines cascade) and restart numbering at #1.
truncate public.orders cascade;
alter table public.orders alter column order_no restart with 1;

commit;

-- Sanity check — these should all come back 0:
--   select coalesce(sum(qty_on_hand), 0) as units_on_hand from public.stock_levels;
--   select count(*) as stocktakes from public.stocktakes;
--   select count(*) as orders from public.orders;


-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ OPTIONAL — wipe the rest of the trial history too
-- ╠══════════════════════════════════════════════════════════════════════════
-- ║ The blocks below are commented out. Run whichever apply — if the trial
-- ║ really was all testing, running all three gives a completely blank slate.
-- ║ To run a block, remove the leading "-- " from each of its lines.
-- ║
-- ║ (a) New-item requests (the "Request a new item" queue):
-- begin;
--   truncate public.requests;
-- commit;
-- ║
-- ║ (b) Reimbursement claims (and their lines + receipt records; the receipt
-- ║     files themselves sit in storage and can be cleared there if wanted):
-- begin;
--   truncate public.claims cascade;
-- commit;
-- ║
-- ║ (c) The stock ledger — every historic movement (receive, checkout,
-- ║     transfer, adjustment, stocktake). This is the audit trail, so only
-- ║     wipe it if you want reports to start from a blank page:
-- begin;
--   truncate public.transactions;
-- commit;
-- ╚══════════════════════════════════════════════════════════════════════════
