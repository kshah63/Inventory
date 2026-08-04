-- Migration 0011 acceptance: catch "we already stock that" before it becomes
-- a request, and resolve the ones that slip through. Run after 0011.
-- Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.item_aliases
where alias in ('post it', 'zz-test-alias');
delete from public.requests where free_text_item like 'zz-test%';

-- ═══ Matching ═══
select public.t_assert(
  exists (select 1 from public.search_catalogue('sticky notes')
          where name like 'Sticky notes%'),
  'an obvious name match is found');

select public.t_assert(
  exists (select 1 from public.search_catalogue('stiky notes')
          where name like 'Sticky notes%'),
  'a typo still finds it');

select public.t_assert(
  exists (select 1 from public.search_catalogue('whiteboard pen')
          where name like 'Whiteboard marker%'),
  'different wording for the same thing is found');

select public.t_assert(
  (select count(*) from public.search_catalogue('a')) = 0,
  'a single letter matches nothing — no suggestion beats a bad one');

select public.t_assert(
  (select count(*) from public.search_catalogue('xyzzy nonexistent widget')) = 0,
  'something we genuinely do not stock matches nothing');

select public.t_assert(
  (select count(*) from public.search_catalogue('pen')) <= 3,
  'at most three suggestions are offered');

-- ═══ Aliases are learned ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- procurement
select public.t_assert(
  (select count(*) from public.search_catalogue('post it')) = 0,
  'unknown wording finds nothing to begin with');

select public.add_item_alias(
  (select id from public.items where name like 'Sticky notes%'), 'post it');

select public.t_assert(
  exists (select 1 from public.search_catalogue('post it')
          where name like 'Sticky notes%' and matched_alias = 'post it'),
  'once taught, the same wording finds the item');

select public.add_item_alias(
  (select id from public.items where name like 'Sticky notes%'), 'POST IT');
select public.t_assert(
  (select count(*) from public.item_aliases where alias ilike 'post it') = 1,
  'the same alias is not stored twice');

-- ═══ Resolving a request from stock ═══
insert into public.requests (requested_by, free_text_item, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'zz-test post it pads', 4, '14');

select public.fulfil_request_from_stock(
  (select id from public.requests where free_text_item = 'zz-test post it pads'),
  (select id from public.items where name like 'Sticky notes%'),
  4);

select public.t_assert(
  (select status from public.requests where free_text_item = 'zz-test post it pads')
    = 'fulfilled',
  'the request closes as fulfilled');

select public.t_assert(
  (select fulfilled_item_id from public.requests
   where free_text_item = 'zz-test post it pads') is not null,
  'and records which catalogue item it turned out to be');

select public.t_assert(
  exists (
    select 1 from public.orders o
    join public.order_lines ol on ol.order_id = o.id
    where o.requested_by = 'aaaaaaaa-0000-0000-0000-000000000002'
      and o.status = 'pending'
      and ol.qty_requested = 4
      and ol.item_id = (select id from public.items where name like 'Sticky notes%')),
  'an order is raised for the person who asked, not for procurement');

-- Closing it twice is refused rather than raising a second order.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.fulfil_request_from_stock(
      (select id from public.requests where free_text_item = 'zz-test post it pads'),
      (select id from public.items where name like 'Sticky notes%'), 1);
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a closed request cannot be resolved twice');
end $$;

-- Only procurement may do this.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- staff
insert into public.requests (requested_by, free_text_item, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'zz-test second', 1, '14');
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.fulfil_request_from_stock(
      (select id from public.requests where free_text_item = 'zz-test second'),
      (select id from public.items where name like 'Sticky notes%'), 1);
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'staff cannot resolve their own request from stock');
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.add_item_alias(
      (select id from public.items where name like 'Sticky notes%'), 'sneaky');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'staff cannot teach the matcher new words');
end $$;

-- Clean up.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note like 'Raised as a request%';
delete from public.orders where note like 'Raised as a request%';
delete from public.requests where free_text_item like 'zz-test%';
delete from public.item_aliases where alias ilike 'post it';

reset test.uid;
select 'STOCK MATCHING TESTS PASSED' as result;
