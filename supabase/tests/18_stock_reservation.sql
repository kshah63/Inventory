-- Migration 0028 acceptance: a pending (placed, not yet collected) order holds
-- its stock, so the same units aren't offered to someone else. Run after 0028.
-- Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note like 'zz-res%';
delete from public.orders where note like 'zz-res%';
delete from public.stock_levels where item_id in (select id from public.items where sku like 'ZZR-%');
delete from public.items where sku like 'ZZR-%';

insert into public.users (id, full_name, role, user_no) values
  ('aaaaaaaa-0000-0000-0000-000000000052', 'zz P2', 'staff', 9952),
  ('aaaaaaaa-0000-0000-0000-000000000053', 'zz P3', 'staff', 9953)
on conflict (id) do nothing;

-- Three items, each with a known quantity in one room.
do $$
declare v_cat uuid; v_loc uuid; v_a uuid; v_b uuid; v_c uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  insert into public.items (sku, name, category_id) values ('ZZR-A', 'zz Res Pen A', v_cat) returning id into v_a;
  insert into public.items (sku, name, category_id) values ('ZZR-B', 'zz Res Pen B', v_cat) returning id into v_b;
  insert into public.items (sku, name, category_id) values ('ZZR-C', 'zz Res Pen C', v_cat) returning id into v_c;
  insert into public.stock_levels (item_id, location_id, qty_on_hand) values
    (v_a, v_loc, 10), (v_b, v_loc, 5), (v_c, v_loc, 10);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Item A: first come, first served
-- ═══════════════════════════════════════════════════════════════════════════
-- Person 1 orders 6 of the 10.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_loc uuid; v_a uuid;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_a from public.items where sku = 'ZZR-A';
  perform public.create_order(v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_a, 'qty', 6)), 'zz-res a1');
end $$;

select public.t_assert(
  (select committed from public.item_committed_qty()
   where item_id = (select id from public.items where sku = 'ZZR-A')) = 6,
  'a pending order shows as committed stock');

-- Person 2 can only see 4 left — 5 is refused, 4 is fine.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000052';
do $$
declare v_loc uuid; v_a uuid; v_ok boolean := false;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_a from public.items where sku = 'ZZR-A';
  begin
    perform public.create_order(v_loc, '14',
      jsonb_build_array(jsonb_build_object('item_id', v_a, 'qty', 5)), 'zz-res a2-bad');
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a second person cannot order more than what is left after reservations');
  perform public.t_assert(not exists (select 1 from public.orders where note = 'zz-res a2-bad'),
    'the over-order leaves nothing behind');

  perform public.create_order(v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_a, 'qty', 4)), 'zz-res a2');
  perform public.t_assert(exists (select 1 from public.orders where note = 'zz-res a2'),
    'they can take exactly what is left');
end $$;

-- Now everything is spoken for: person 3 is refused even though stock > 0.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000053';
do $$
declare v_loc uuid; v_a uuid; v_ok boolean := false;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_a from public.items where sku = 'ZZR-A';
  begin
    perform public.create_order(v_loc, '14',
      jsonb_build_array(jsonb_build_object('item_id', v_a, 'qty', 1)), 'zz-res a3-bad');
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nothing can be ordered once every unit is reserved, even with stock on the shelf');
end $$;

-- Once person 1's order is packed it leaves the pending set (and its stock has
-- physically come off the shelf), so it is never counted twice. Only pending
-- orders are committed, so moving it off 'pending' drops committed 10 → 4.
-- (We set the status directly rather than pack_order, to avoid writing an
-- immutable ledger row against a throwaway test item — the committed tally
-- keys off status, which is what's under test here.)
update public.orders set status = 'ready' where note = 'zz-res a1';

select public.t_assert(
  (select committed from public.item_committed_qty()
   where item_id = (select id from public.items where sku = 'ZZR-A')) = 4,
  'a packed order no longer counts as committed (not double-counted against stock)');

-- ═══════════════════════════════════════════════════════════════════════════
-- Item B: a cancelled/declined order frees its stock again
-- ═══════════════════════════════════════════════════════════════════════════
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_loc uuid; v_b uuid;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_b from public.items where sku = 'ZZR-B';
  perform public.create_order(v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_b, 'qty', 5)), 'zz-res b1');
end $$;

-- All 5 reserved. Procurement declines it.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.reject_order((select id from public.orders where note = 'zz-res b1'), 'zz decline');

select public.t_assert(
  coalesce((select committed from public.item_committed_qty()
            where item_id = (select id from public.items where sku = 'ZZR-B')), 0) = 0,
  'a declined order holds no stock');

-- So the 5 are available to someone else again.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000052';
do $$
declare v_loc uuid; v_b uuid;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_b from public.items where sku = 'ZZR-B';
  perform public.create_order(v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_b, 'qty', 5)), 'zz-res b2');
  perform public.t_assert(exists (select 1 from public.orders where note = 'zz-res b2'),
    'the freed stock can be ordered by someone else');
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Item C: editing an order respects everyone else's reservations
-- ═══════════════════════════════════════════════════════════════════════════
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_loc uuid; v_c uuid;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_c from public.items where sku = 'ZZR-C';
  perform public.create_order(v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_c, 'qty', 4)), 'zz-res c1');
end $$;
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000052';
do $$
declare v_loc uuid; v_c uuid;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_c from public.items where sku = 'ZZR-C';
  perform public.create_order(v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_c, 'qty', 4)), 'zz-res c2');
end $$;

-- 10 on the shelf, 8 reserved (4 + 4). Person 1 editing their own 4 frees it,
-- so they have 6 to play with — 10 is refused, 6 is fine.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_c uuid; v_order uuid; v_ok boolean := false;
begin
  select id into v_c from public.items where sku = 'ZZR-C';
  select id into v_order from public.orders where note = 'zz-res c1';
  begin
    perform public.edit_order(v_order, jsonb_build_array(jsonb_build_object('item_id', v_c, 'qty', 10)));
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'an edit cannot grab stock another pending order already holds');

  perform public.edit_order(v_order, jsonb_build_array(jsonb_build_object('item_id', v_c, 'qty', 6)));
  perform public.t_assert(
    (select qty_requested from public.order_lines where order_id = v_order) = 6,
    'an edit up to what is actually available is allowed');
end $$;

-- cleanup
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note like 'zz-res%';
delete from public.orders where note like 'zz-res%';
delete from public.stock_levels where item_id in (select id from public.items where sku like 'ZZR-%');
delete from public.items where sku like 'ZZR-%';
delete from public.users where id in
  ('aaaaaaaa-0000-0000-0000-000000000052', 'aaaaaaaa-0000-0000-0000-000000000053');

reset test.uid;
select 'STOCK RESERVATION TESTS PASSED' as result;
