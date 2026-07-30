-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0007 — Requests are for NEW items only; individual zones
--
--  • Requests gain a description, a product link and a photo, and no longer
--    need a store room (everything is delivered to the procurement room).
--  • Zones are individual numbers 3–22 instead of grouped ranges.
-- Run once, after 0006. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Richer new-item requests.
alter table public.requests add column if not exists description text;
alter table public.requests add column if not exists product_url text;
alter table public.requests add column if not exists photo_url text;

-- Deliveries all land in the procurement room, so the store room is optional.
alter table public.requests alter column location_id drop not null;

-- 2. Zones 3 … 22, individually.
update public.settings
set value = (select jsonb_agg(g::text order by g) from generate_series(3, 22) g),
    updated_at = now()
where key = 'zones';

-- Bring existing rows onto the new labels ("Zone 7" → "7"). The transactions
-- ledger is deliberately append-only, so historical checkout rows keep the
-- label they were stamped with — reports will show those older values as
-- their own groups.
update public.orders
set zone = trim(regexp_replace(zone, '^\s*[Zz]one\s*', ''))
where zone is not null and zone ~* '^\s*zone\s';

update public.requests
set zone = trim(regexp_replace(zone, '^\s*[Zz]one\s*', ''))
where zone is not null and zone ~* '^\s*zone\s';

-- 3. Photos for requested items — any signed-in person can add one to their
--    own request; everyone can view them.
insert into storage.buckets (id, name, public)
values ('request-photos', 'request-photos', true)
on conflict (id) do nothing;

drop policy if exists "request photos are public" on storage.objects;
create policy "request photos are public" on storage.objects
  for select using (bucket_id = 'request-photos');

drop policy if exists "signed in users add request photos" on storage.objects;
create policy "signed in users add request photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'request-photos');
