-- Migration 0025 acceptance: expressing interest is a soft, per-person,
-- toggleable signal, scoped to visible items, private to you and procurement.
-- Run after 0025. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.item_interest where item_id in (select id from public.items where sku like 'ZZI-%');
delete from public.items where sku like 'ZZI-%';

do $$
declare v_cat uuid; v_i uuid; v_admin uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  insert into public.items (sku, name, category_id) values ('ZZI-1', 'zz Interest Pen', v_cat)
    returning id into v_i;
  insert into public.items (sku, name, category_id, admin_only)
    values ('ZZI-2', 'zz Secret Supply', v_cat, true) returning id into v_admin;
end $$;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- staff

-- ═══ Express interest, idempotently ═══
do $$
declare v_i uuid;
begin
  select id into v_i from public.items where sku = 'ZZI-1';
  perform public.express_interest(v_i);
  perform public.express_interest(v_i);  -- pressing twice is still one signal
  perform public.t_assert(
    (select count(*) from public.item_interest where item_id = v_i) = 1,
    'expressing interest is one signal per person, however many times pressed');
end $$;

-- ═══ Can't express interest in something you can't see ═══
do $$
declare v_admin uuid; v_ok boolean := false;
begin
  select id into v_admin from public.items where sku = 'ZZI-2';
  begin
    perform public.express_interest(v_admin);
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'interest cannot be expressed in a hidden central-team item');
end $$;

-- ═══ Withdrawing removes it ═══
do $$
declare v_i uuid;
begin
  select id into v_i from public.items where sku = 'ZZI-1';
  perform public.express_interest(v_i);
  perform public.withdraw_interest(v_i);
  perform public.t_assert(
    (select count(*) from public.item_interest where item_id = v_i) = 0,
    'withdrawing interest removes the signal');
end $$;

-- ═══ One person's interest is private to them (and procurement) ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ declare v_i uuid; begin
  select id into v_i from public.items where sku = 'ZZI-1';
  perform public.express_interest(v_i);
end $$;
-- A different, non-admin staff member: RLS should hide the first one's row.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000003';
set role authenticated;
select public.t_assert(
  (select count(*) from public.item_interest
   where item_id = (select id from public.items where sku = 'ZZI-1')) = 0,
  'another staff member cannot see who else expressed interest');
reset role;

-- cleanup
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.item_interest where item_id in (select id from public.items where sku like 'ZZI-%');
delete from public.items where sku like 'ZZI-%';

select 'ITEM INTEREST TESTS PASSED' as result;
