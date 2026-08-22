-- Migration 0013 acceptance: the received stage stays ours, the expected
-- date is theirs. Run after 0013. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.requests where free_text_item like 'zz-delivery%';

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- Priya (staff)
insert into public.requests (requested_by, free_text_item, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'zz-delivery test', 2, '14');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- procurement

-- ═══ Ordered: no news for the requester, but a date they can see ═══
select public.t_assert(
  (public.set_request_progress(
     (select id from public.requests where free_text_item = 'zz-delivery test'),
     'ordered', '2026-08-20') ->> 'notify')::boolean = false,
  'being ordered does not message the requester');

select public.t_assert(
  (select expected_date from public.requests where free_text_item = 'zz-delivery test')
    = date '2026-08-20',
  'the expected date is stored for them to see');

-- ═══ Received: ours alone ═══
select public.t_assert(
  (public.set_request_progress(
     (select id from public.requests where free_text_item = 'zz-delivery test'),
     'received') ->> 'notify')::boolean = false,
  'stock arriving does not message the requester');

select public.t_assert(
  (select received_at is not null from public.requests
   where free_text_item = 'zz-delivery test'),
  'and the arrival is timestamped for us');

-- ═══ Ready: now they hear about it ═══
select public.t_assert(
  (public.set_request_progress(
     (select id from public.requests where free_text_item = 'zz-delivery test'),
     'ready') ->> 'notify')::boolean = true,
  'ready to collect does message the requester');

select public.t_assert(
  (select received_at from public.requests where free_text_item = 'zz-delivery test')
    is not null,
  'the arrival time survives the next step');

-- Setting the same status again is not fresh news.
select public.t_assert(
  (public.set_request_progress(
     (select id from public.requests where free_text_item = 'zz-delivery test'),
     'ready') ->> 'notify')::boolean = false,
  'the same status twice does not message them twice');

-- ═══ Clearing a date ═══
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-delivery test'),
  null, null, true);
select public.t_assert(
  (select expected_date from public.requests where free_text_item = 'zz-delivery test')
    is null,
  'an expected date can be cleared');

-- ═══ Only procurement drives this ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.set_request_progress(
      (select id from public.requests where free_text_item = 'zz-delivery test'), 'ready');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'staff cannot move their own request along');
end $$;

-- ═══ In-flight counts include the hidden stage ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.t_assert(
  (public.get_dashboard_stats() ? 'requests_to_hand_over'),
  'the dashboard counts requests waiting to be handed over');

delete from public.requests where free_text_item like 'zz-delivery%';
reset test.uid;
select 'REQUEST DELIVERY TESTS PASSED' as result;
