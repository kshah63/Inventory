-- Migration 0020 acceptance: a claim is money, it is private, and it is
-- yours to change only until it is settled. Run after 0020. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.claims where reason like 'zz-claim%';

-- ═══ Raising one ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- Priya, staff
select public.create_claim('14', 'zz-claim shop was out at the store room',
  jsonb_build_array(
    jsonb_build_object('description', 'Whiteboard markers x4', 'amount_cents', 1280),
    jsonb_build_object('description', 'Masking tape', 'amount_cents', 350)
  ));

select public.t_assert(
  (select sum(amount_cents) from public.claim_lines cl
   join public.claims c on c.id = cl.claim_id where c.reason like 'zz-claim%') = 1630,
  'a claim totals its lines, in whole cents');

select public.t_assert(
  (select status from public.claims where reason like 'zz-claim%') = 'requested',
  'and starts as requested');

-- ═══ The reason is the point of the exercise ═══
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.create_claim('14', '   ',
      jsonb_build_array(jsonb_build_object('description', 'x', 'amount_cents', 100)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a claim without a reason is refused');
end $$;

-- ═══ Money has to be money ═══
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.create_claim('14', 'zz-claim bad amount',
      jsonb_build_array(jsonb_build_object('description', 'x', 'amount_cents', 0)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a line of zero is refused');
end $$;

-- ═══ Nobody else's business ═══
-- Seeded before the role switch: RLS is not enforced for the owner, which is
-- exactly why the assertions below have to run as somebody else.
insert into public.users (id, full_name, role, user_no)
values ('aaaaaaaa-0000-0000-0000-000000000077', 'zz Nosy Head', 'dept_head', 9977)
on conflict (id) do update set role = 'dept_head', is_active = true;

set role authenticated;
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000077';

select public.t_assert(
  not exists (select 1 from public.claims where reason like 'zz-claim%'),
  'somebody else cannot see your claim');
select public.t_assert(
  not exists (select 1 from public.claim_lines cl
              join public.claims c on c.id = cl.claim_id
              where c.reason like 'zz-claim%'),
  'nor what you spent it on');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- procurement
select public.t_assert(
  exists (select 1 from public.claims where reason like 'zz-claim%'),
  'procurement can, because they are the ones paying');
reset role;

-- ═══ Editable while requested ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
select public.edit_claim(
  (select id from public.claims where reason like 'zz-claim%'),
  '14', 'zz-claim shop was out at the store room',
  jsonb_build_array(
    jsonb_build_object('description', 'Whiteboard markers x4', 'amount_cents', 1280)));

select public.t_assert(
  (select sum(amount_cents) from public.claim_lines cl
   join public.claims c on c.id = cl.claim_id where c.reason like 'zz-claim%') = 1280,
  'the claimant can correct it while it is still requested');

-- ═══ Only procurement settles it ═══
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.set_claim_status(
      (select id from public.claims where reason like 'zz-claim%'), 'paid');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'you cannot mark your own claim paid');
end $$;

-- ═══ Declining needs a reason ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.set_claim_status(
      (select id from public.claims where reason like 'zz-claim%'), 'declined');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'declining without saying why is refused');
end $$;

select public.set_claim_status(
  (select id from public.claims where reason like 'zz-claim%'), 'paid', 'Paid with June payroll');
select public.t_assert(
  (select status from public.claims where reason like 'zz-claim%') = 'paid'
  and (select decided_at from public.claims where reason like 'zz-claim%') is not null,
  'procurement marks it paid, and when is recorded');

-- ═══ Settled is settled ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.edit_claim(
      (select id from public.claims where reason like 'zz-claim%'),
      '14', 'zz-claim changed my mind',
      jsonb_build_array(jsonb_build_object('description', 'More', 'amount_cents', 99999)));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a paid claim can no longer be edited');
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.cancel_claim(
      (select id from public.claims where reason like 'zz-claim%'));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nor cancelled');
end $$;

-- ═══ Cancelling one that is still open takes its lines with it ═══
select public.create_claim('14', 'zz-claim to be cancelled',
  jsonb_build_array(jsonb_build_object('description', 'Oops', 'amount_cents', 500)));
do $$
declare v_id uuid;
begin
  select id into v_id from public.claims where reason = 'zz-claim to be cancelled';
  perform public.cancel_claim(v_id);
  perform public.t_assert(
    not exists (select 1 from public.claim_lines where claim_id = v_id),
    'cancelling an open claim removes its lines too');
end $$;

-- ═══ Receipts are not world-readable, unlike the other buckets ═══
select public.t_assert(
  (select public from storage.buckets where id = 'claim-receipts') = false,
  'the receipts bucket is private');

-- Clean up.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.claims where reason like 'zz-claim%';
update public.users set is_active = false
where id = 'aaaaaaaa-0000-0000-0000-000000000077';

reset test.uid;
select 'CLAIMS TESTS PASSED' as result;
