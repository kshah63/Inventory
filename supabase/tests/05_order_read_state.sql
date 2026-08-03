-- Migration 0010 acceptance: the requester is told when their order moves.
-- Run after 0010. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Priya orders something.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_item uuid; v_loc uuid;
begin
  select id into v_item from public.items where is_active and max_per_checkout is null limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  perform public.create_order(
    v_loc, '14', jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1)),
    'read-state test');
end $$;

select public.t_assert(public.unread_order_count() = 0,
  'placing your own order is not news to you');

-- Procurement packs it.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_order uuid; v_loc uuid; v_line record;
begin
  select id into v_order from public.orders
  where note = 'read-state test' and status = 'pending'
  order by created_at desc limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  select item_id, qty_requested into v_line from public.order_lines where order_id = v_order limit 1;
  perform public.pack_order(
    v_order, v_loc,
    jsonb_build_array(jsonb_build_object('item_id', v_line.item_id, 'qty', v_line.qty_requested)));
end $$;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
select public.t_assert(public.unread_order_count() = 1,
  'the requester has one unread order once procurement packs it');

select public.t_assert(
  (select status_changed_by from public.orders
   where note = 'read-state test' order by created_at desc limit 1)
    = 'aaaaaaaa-0000-0000-0000-000000000001',
  'the change is attributed to whoever made it');

-- Opening My orders clears it.
select public.mark_orders_seen();
select public.t_assert(public.unread_order_count() = 0,
  'opening My orders clears the marker');

-- Collecting it is news again.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_order uuid;
begin
  select id into v_order from public.orders
  where note = 'read-state test' and status = 'ready'
  order by created_at desc limit 1;
  perform public.collect_order(v_order);
end $$;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
select public.t_assert(public.unread_order_count() = 1,
  'a second status change marks it unread again');
select public.mark_orders_seen();

-- Someone else's order never counts.
select public.t_assert(public.unread_order_count() = 0, 'and clears again');
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.t_assert(public.unread_order_count() = 0,
  'nobody sees an unread marker for another person''s order');

reset test.uid;
select 'ORDER READ-STATE TESTS PASSED' as result;
