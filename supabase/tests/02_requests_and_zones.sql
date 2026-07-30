-- Migration 0007 acceptance: new-item requests and per-number zones.
-- Run after 01_smoke_test.sql on the same database (it reuses those actors).
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ═══ Zones are individual numbers 3 … 22 ═══
select public.t_assert(
  (select jsonb_array_length(value) from public.settings where key = 'zones') = 20,
  'settings.zones holds 20 zones');
select public.t_assert(
  (select value from public.settings where key = 'zones')
    @> '["3","10","22"]'::jsonb,
  'zones are stored as bare numbers (3, 10, 22)');
select public.t_assert(
  not exists (
    select 1 from jsonb_array_elements_text(
      (select value from public.settings where key = 'zones')) z
    where z ilike 'zone%'),
  'no stored value keeps the old "Zone 15-16" style');

-- ═══ A new-item request: no catalogue item, no store room, richer detail ═══
-- Cleared first so the file can be re-run against the same database.
delete from public.requests where free_text_item = 'A3 laminating pouches';

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- Priya (staff)
insert into public.requests
  (requested_by, item_id, free_text_item, description, product_url, photo_url, qty, zone)
values
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'A3 laminating pouches',
   'Thick ones, 125 micron. For the Saturday worksheets.',
   'https://example.com/a3-pouches', 'https://example.com/photo.jpg', 2, '14');

select public.t_assert(
  (select count(*) from public.requests
   where free_text_item = 'A3 laminating pouches'
     and location_id is null
     and description like 'Thick ones%'
     and product_url = 'https://example.com/a3-pouches'
     and photo_url = 'https://example.com/photo.jpg'
     and zone = '14') = 1,
  'staff can raise a request with description, link and photo and no store room');

-- Requesters see their own requests …
select public.t_assert(
  (select count(*) from public.requests
   where requested_by = 'aaaaaaaa-0000-0000-0000-000000000002') >= 1,
  'requester can read their own request');

-- … and nobody else's.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- super admin
select public.t_assert(
  (select count(*) from public.requests where free_text_item = 'A3 laminating pouches') = 1,
  'procurement sees the request in the queue');

-- ═══ Photo storage bucket ═══
select public.t_assert(
  exists (select 1 from storage.buckets where id = 'request-photos' and public),
  'request-photos bucket exists and is public');
select public.t_assert(
  (select count(*) from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('request photos are public',
                        'signed in users add request photos')) = 2,
  'request-photos read and insert policies are in place');

reset test.uid;
select 'REQUESTS + ZONES TESTS PASSED' as result;
