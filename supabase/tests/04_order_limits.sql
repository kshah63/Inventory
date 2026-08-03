-- Migration 0009 acceptance: a per-item cap can't be beaten by one order.
-- Run after 0009. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- A capped item and an uncapped one, both well stocked.
do $$
declare
  v_cat uuid;
  v_loc uuid;
  v_item uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;

  insert into public.items (sku, name, category_id, unit, max_per_checkout)
  values ('LIMIT-01', 'Capped test item', v_cat, 'pcs', 5)
  on conflict (sku) do update set max_per_checkout = 5, is_active = true
  returning id into v_item;

  insert into public.stock_levels (item_id, location_id, qty_on_hand)
  values (v_item, v_loc, 100)
  on conflict (item_id, location_id) do update set qty_on_hand = 100;
end $$;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- Priya (staff)

-- Within the cap: fine.
do $$
declare v_item uuid; v_loc uuid;
begin
  select id into v_item from public.items where sku = 'LIMIT-01';
  select id into v_loc from public.locations where is_active order by name limit 1;
  perform public.create_order(
    v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 5)));
  raise notice 'PASS: an order at exactly the cap is accepted';
end $$;

-- Over the cap: refused.
do $$
declare v_item uuid; v_loc uuid; v_ok boolean := false;
begin
  select id into v_item from public.items where sku = 'LIMIT-01';
  select id into v_loc from public.locations where is_active order by name limit 1;
  begin
    perform public.create_order(
      v_loc, '14',
      jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 6)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'an order over the cap is refused');
end $$;

-- Split across two lines of the same order: still refused (3 + 3 > 5).
do $$
declare v_item uuid; v_loc uuid; v_ok boolean := false;
begin
  select id into v_item from public.items where sku = 'LIMIT-01';
  select id into v_loc from public.locations where is_active order by name limit 1;
  begin
    perform public.create_order(
      v_loc, '14',
      jsonb_build_array(
        jsonb_build_object('item_id', v_item, 'qty', 3),
        jsonb_build_object('item_id', v_item, 'qty', 3)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'the cap cannot be split across two lines');
end $$;

-- Nothing was left behind by the refused attempts.
select public.t_assert(
  (select count(*) from public.orders o
   join public.order_lines ol on ol.order_id = o.id
   join public.items i on i.id = ol.item_id
   where i.sku = 'LIMIT-01' and o.status <> 'cancelled') = 1,
  'only the accepted order exists');

-- An uncapped item is unaffected.
do $$
declare v_item uuid; v_loc uuid;
begin
  select id into v_item from public.items where max_per_checkout is null and is_active limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  perform public.create_order(
    v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 40)));
  raise notice 'PASS: an uncapped item takes any quantity';
end $$;

-- Department Heads order like everyone else.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.users set role = 'dept_head'
where id = 'aaaaaaaa-0000-0000-0000-000000000002';
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_item uuid; v_loc uuid;
begin
  select id into v_item from public.items where sku = 'LIMIT-01';
  select id into v_loc from public.locations where is_active order by name limit 1;
  perform public.create_order(
    v_loc, '14', jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1)));
  raise notice 'PASS: a Department Head can place an order';
end $$;
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.users set role = 'staff' where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- Clean up so the file can be run again.
delete from public.order_lines ol
using public.items i where ol.item_id = i.id and i.sku = 'LIMIT-01';
delete from public.orders o
where not exists (select 1 from public.order_lines ol where ol.order_id = o.id);

reset test.uid;
select 'ORDER LIMIT TESTS PASSED' as result;
