-- Migration 0017 acceptance: a request you've collected is yours to tick,
-- the same as an order. Run after 0017. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.requests where free_text_item like 'zz-collect%';

-- A department head asks for something we don't stock.
insert into public.users (id, full_name, role, user_no)
values ('aaaaaaaa-0000-0000-0000-000000000077', 'zz Head', 'dept_head', 9977)
on conflict (id) do update set role = 'dept_head', is_active = true;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000077';
insert into public.requests (requested_by, free_text_item, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000077', 'zz-collect item', 2, '14');

-- ═══ Not before it's ready ═══
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.collect_request(
      (select id from public.requests where free_text_item = 'zz-collect item'));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a request that is not ready cannot be collected');
end $$;

-- Procurement orders it, it arrives, and it goes out on the shelf.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-collect item'), 'ordered');
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-collect item'), 'received');
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-collect item'), 'ready');

-- ═══ Not somebody else's ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.collect_request(
      (select id from public.requests where free_text_item = 'zz-collect item'));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nobody can collect somebody else''s request');
end $$;

-- ═══ The department head ticks their own ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000077';
select public.collect_request(
  (select id from public.requests where free_text_item = 'zz-collect item'));

select public.t_assert(
  (select status from public.requests where free_text_item = 'zz-collect item')
    = 'fulfilled',
  'a department head can tick their own request as collected');
select public.t_assert(
  (select collected_at from public.requests where free_text_item = 'zz-collect item')
    is not null,
  'and when they collected it is recorded');

-- ═══ Once only ═══
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.collect_request(
      (select id from public.requests where free_text_item = 'zz-collect item'));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'and it cannot be collected twice');
end $$;

-- ═══ Procurement can still tick it for someone who forgets ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000077';
insert into public.requests (requested_by, free_text_item, qty, zone)
values ('aaaaaaaa-0000-0000-0000-000000000077', 'zz-collect forgotten', 1, '14');
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.set_request_progress(
  (select id from public.requests where free_text_item = 'zz-collect forgotten'), 'ready');
select public.collect_request(
  (select id from public.requests where free_text_item = 'zz-collect forgotten'));
select public.t_assert(
  (select status from public.requests where free_text_item = 'zz-collect forgotten')
    = 'fulfilled',
  'procurement can tick it for somebody who forgot');

-- Clean up. The test head is deactivated rather than deleted: once anything
-- has been attributed to somebody the ledger holds them, which is the same
-- rule the delete_item tests rely on.
delete from public.requests where free_text_item like 'zz-collect%';
update public.users set is_active = false
where id = 'aaaaaaaa-0000-0000-0000-000000000077';

reset test.uid;
select 'COLLECT REQUEST TESTS PASSED' as result;
