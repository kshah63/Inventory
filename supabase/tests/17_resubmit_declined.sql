-- Migration 0027 acceptance: a declined order or bought-in request can be
-- corrected and resubmitted, instead of raised from scratch. Run after 0027.
-- Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note = 'zz-resubmit test';
delete from public.orders where note = 'zz-resubmit test';
delete from public.requests where free_text_item like 'zz-resubmit%';

insert into public.users (id, full_name, role, user_no)
values ('aaaaaaaa-0000-0000-0000-000000000009', 'zz Nosy', 'staff', 9998)
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- ORDERS
-- ═══════════════════════════════════════════════════════════════════════════

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
    'zz-resubmit test');
end $$;

-- Procurement declines it with a reason.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.reject_order(
  (select id from public.orders where note = 'zz-resubmit test'),
  'We only stock these by the box — order the box instead.');

select public.t_assert(
  (select status from public.orders where note = 'zz-resubmit test') = 'rejected'
  and (select admin_note from public.orders where note = 'zz-resubmit test') is not null,
  'a declined order is rejected and carries procurement''s reason');

-- ═══ A declined order can't be resubmitted by someone else ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000009';
do $$
declare v_order uuid; v_item uuid; v_ok boolean := false;
begin
  select id into v_order from public.orders where note = 'zz-resubmit test';
  select item_id into v_item from public.order_lines where order_id = v_order limit 1;
  begin
    perform public.edit_order(
      v_order, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 2)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nobody can resubmit somebody else''s declined order');
end $$;

-- ═══ The requester corrects it and sends it back ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_order uuid; v_item uuid;
begin
  select id into v_order from public.orders where note = 'zz-resubmit test';
  select item_id into v_item from public.order_lines where order_id = v_order limit 1;
  perform public.edit_order(
    v_order, jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 2)));
end $$;

select public.t_assert(
  (select status from public.orders where note = 'zz-resubmit test') = 'pending',
  'correcting a declined order returns it to pending');
select public.t_assert(
  (select admin_note from public.orders where note = 'zz-resubmit test') is null,
  'resubmitting a declined order clears the old decline note');
select public.t_assert(
  (select qty_requested from public.order_lines ol
   join public.orders o on o.id = ol.order_id where o.note = 'zz-resubmit test') = 2,
  'the correction to the order is kept');

-- ═══════════════════════════════════════════════════════════════════════════
-- REQUESTS
-- ═══════════════════════════════════════════════════════════════════════════

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
insert into public.requests (requested_by, free_text_item, description, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'zz-resubmit req', 'the wrong size', 6, '14');

-- Procurement declines it with a reason.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-resubmit req'),
  'rejected', null, false, 'Tell us the exact dimensions and we''ll source it.');

select public.t_assert(
  (select status from public.requests where free_text_item = 'zz-resubmit req') = 'rejected'
  and (select admin_note from public.requests where free_text_item = 'zz-resubmit req') is not null,
  'a declined request is rejected and carries procurement''s reason');

-- ═══ Not someone else's to resubmit ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000009';
do $$
declare v_req uuid; v_ok boolean := false;
begin
  select id into v_req from public.requests where free_text_item = 'zz-resubmit req';
  begin
    perform public.edit_request(v_req, 'zz-resubmit req', null, null, null, 2, '14');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nobody can resubmit somebody else''s declined request');
end $$;

-- ═══ The requester fixes the detail and sends it back ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_req uuid;
begin
  select id into v_req from public.requests where free_text_item = 'zz-resubmit req';
  perform public.edit_request(
    v_req, 'zz-resubmit req', 'A4, 250gsm, white', 'https://example.com/card', null, 3, '14');
end $$;

select public.t_assert(
  (select status from public.requests where free_text_item = 'zz-resubmit req') = 'open',
  'correcting a declined request returns it to open');
select public.t_assert(
  (select admin_note from public.requests where free_text_item = 'zz-resubmit req') is null,
  'resubmitting a declined request clears the old decline note');
select public.t_assert(
  (select qty from public.requests where free_text_item = 'zz-resubmit req') = 3
  and (select description from public.requests where free_text_item = 'zz-resubmit req') = 'A4, 250gsm, white'
  and (select product_url from public.requests where free_text_item = 'zz-resubmit req') = 'https://example.com/card',
  'the corrections to the request are kept');

-- ═══ Blank item and non-positive quantity are refused ═══
do $$
declare v_req uuid; v_ok boolean := false;
begin
  select id into v_req from public.requests where free_text_item = 'zz-resubmit req';
  begin
    perform public.edit_request(v_req, '   ', null, null, null, 3, '14');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a request must still say what is needed');
end $$;
do $$
declare v_req uuid; v_ok boolean := false;
begin
  select id into v_req from public.requests where free_text_item = 'zz-resubmit req';
  begin
    perform public.edit_request(v_req, 'zz-resubmit req', null, null, null, 0, '14');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a request quantity must be at least one');
end $$;

-- ═══ Once it is on order, an edit is refused — a note is the channel ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
insert into public.requests (requested_by, free_text_item, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'zz-resubmit onorder', 2, '14');
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-resubmit onorder'), 'ordered');
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_req uuid; v_ok boolean := false;
begin
  select id into v_req from public.requests where free_text_item = 'zz-resubmit onorder';
  begin
    perform public.edit_request(v_req, 'zz-resubmit onorder', null, null, null, 9, '14');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a request already on order can no longer be edited');
end $$;

-- Clean up.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note = 'zz-resubmit test';
delete from public.orders where note = 'zz-resubmit test';
delete from public.requests where free_text_item like 'zz-resubmit%';
delete from public.users where id = 'aaaaaaaa-0000-0000-0000-000000000009';

reset test.uid;
select 'RESUBMIT DECLINED TESTS PASSED' as result;
