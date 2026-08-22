-- Migration 0014 acceptance: change your mind while it's still yours to
-- change, and tick your own collection. Run after 0014. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note = 'zz-edit test';
delete from public.orders where note = 'zz-edit test';

-- Priya orders 6 of something.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_item uuid; v_loc uuid;
begin
  select id into v_item from public.items
  where is_active and max_per_checkout is null order by name limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  perform public.create_order(
    v_loc, '14', jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 6)),
    'zz-edit test');
end $$;

-- ═══ Second thoughts: 6 → 2 ═══
do $$
declare v_order uuid; v_item uuid;
begin
  select id into v_order from public.orders where note = 'zz-edit test';
  select item_id into v_item from public.order_lines where order_id = v_order limit 1;
  perform public.edit_order(
    v_order, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 2)));
end $$;

select public.t_assert(
  (select qty_requested from public.order_lines ol
   join public.orders o on o.id = ol.order_id where o.note = 'zz-edit test') = 2,
  'the requester can change their own quantity');

-- ═══ Not someone else's ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000009';
insert into public.users (id, full_name, role, user_no)
values ('aaaaaaaa-0000-0000-0000-000000000009', 'zz Nosy', 'staff', 9998)
on conflict (id) do nothing;
do $$
declare v_order uuid; v_item uuid; v_ok boolean := false;
begin
  select id into v_order from public.orders where note = 'zz-edit test';
  select item_id into v_item from public.order_lines where order_id = v_order limit 1;
  begin
    perform public.edit_order(
      v_order, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 99)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nobody can edit somebody else''s order');
end $$;

-- ═══ Emptying it entirely is a cancellation, not an edit ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_order uuid; v_ok boolean := false;
begin
  select id into v_order from public.orders where note = 'zz-edit test';
  begin
    perform public.edit_order(v_order, '[]'::jsonb);
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'an order cannot be edited down to nothing');
end $$;

-- ═══ Once packing starts, the quantities are physical ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_order uuid; v_loc uuid; v_item uuid;
begin
  select id into v_order from public.orders where note = 'zz-edit test';
  select id into v_loc from public.locations where is_active order by name limit 1;
  select item_id into v_item from public.order_lines where order_id = v_order limit 1;
  perform public.pack_order(
    v_order, v_loc, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 2)));
end $$;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_order uuid; v_item uuid; v_ok boolean := false;
begin
  select id into v_order from public.orders where note = 'zz-edit test';
  select item_id into v_item from public.order_lines where order_id = v_order limit 1;
  begin
    perform public.edit_order(
      v_order, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 5)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a packed order can no longer be edited');
end $$;

-- ═══ Collecting is the requester's own tick now ═══
select public.collect_order((select id from public.orders where note = 'zz-edit test'));
select public.t_assert(
  (select status from public.orders where note = 'zz-edit test') = 'collected',
  'the requester can tick their own collection');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000009';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.collect_order((select id from public.orders where note = 'zz-edit test'));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nobody can collect somebody else''s order');
end $$;

-- ═══ Requests can be re-thought while still open ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
delete from public.requests where free_text_item = 'zz-qty test';
insert into public.requests (requested_by, free_text_item, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'zz-qty test', 6, '14');
select public.update_request_qty(
  (select id from public.requests where free_text_item = 'zz-qty test'), 2);
select public.t_assert(
  (select qty from public.requests where free_text_item = 'zz-qty test') = 2,
  'a request quantity can be corrected while open');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-qty test'), 'ordered');
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.update_request_qty(
      (select id from public.requests where free_text_item = 'zz-qty test'), 9);
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'once we have ordered it, the quantity is fixed');
end $$;

-- Clean up.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.requests where free_text_item = 'zz-qty test';
delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note = 'zz-edit test';
delete from public.orders where note = 'zz-edit test';
delete from public.users where id = 'aaaaaaaa-0000-0000-0000-000000000009';

reset test.uid;
select 'EDIT AND COLLECT TESTS PASSED' as result;
