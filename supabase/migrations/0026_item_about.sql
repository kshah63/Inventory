-- 0026_item_about.sql
-- A short, user-facing note shown to people ordering an item in the
-- catalogue — to make a niche item (e.g. "black cardboard") make sense. This
-- is deliberately separate from items.notes, which is an internal field for
-- supplier/shelf/remarks and stays hidden from staff.
--
-- Just a nullable column; the existing items read policy governs who sees the
-- row. Safe on a live database; re-runnable.

alter table public.items add column if not exists about text;
