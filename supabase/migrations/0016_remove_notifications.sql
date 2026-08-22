-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0016 — WhatsApp notifications removed
--
--  The app no longer sends anything to anybody: no digest, no out-of-stock
--  alert, no request update. People see where things stand when they open
--  the app. Notifications will come back as part of the larger app.
--
--  This clears what the feature had stored. The two schema objects it used
--  are deliberately left in place:
--    • users.phone — real numbers people have entered, useful later, and
--      dropping a column the deployed app still selects is what logged
--      everyone out in 0008.
--    • notifications_log — a record of what was sent while it was on.
--      Nothing writes to it now; it costs nothing to keep and would be
--      unrecoverable if dropped.
-- Run once, after 0015. Safe on a live database. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- The recipient list held phone numbers for a purpose that no longer
-- exists, so it goes rather than sitting there.
delete from public.settings
where key in ('whatsapp_recipients', 'digest_enabled', 'alerts_enabled');

-- Only ever read to decide what to put in the daily WhatsApp digest.
drop function if exists public.get_digest_data();
