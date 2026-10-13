-- 0030_item_allow_single.sql
-- Per-item control over how it can be ordered from the catalogue. Until now a
-- pack size implied "single OR pack"; there was no way to say "pack only"
-- (don't let people break open a pack), and the choice wasn't an explicit
-- setting. This adds one flag so each item (and each variant — variants are
-- items) can be set to:
--   • pack size blank            → single only        (e.g. an eraser)
--   • pack size N, allow_single  → single or pack      (e.g. pencils)
--   • pack size N, not allowed   → pack only
-- It's display/ordering UX only — no stock or ledger behaviour changes — and
-- can be changed any time from the item form.
--
-- Safe on a live database; re-runnable.

alter table public.items
  add column if not exists allow_single boolean not null default true;
