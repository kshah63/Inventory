-- Migration 0021 acceptance: the supplier register assigns codes by the
-- rules, never reuses them, and is invisible outside the central team.
-- Run after 0021. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.suppliers where name like 'zz %';
delete from public.supplier_subgroups where name like 'zz %';

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- procurement

-- ═══ The seed is the approved sheet ═══
select public.t_assert(
  (select count(*) from public.supplier_groups) = 15
  and (select count(*) from public.supplier_subgroups) = 34
  and (select count(*) from public.suppliers) >= 128
  and (select count(*) from public.supplier_aliases) >= 205,
  'the approved master is seeded in full');

select public.t_assert(
  (select group_code || '-' || sub_code from public.suppliers
   where name = 'TEKKA PLACE') = '24100-122',
  'a spot-checked code matches the approved sheet');

-- ═══ Codes are assigned, not chosen ═══
do $$
declare v_sg uuid; v_res jsonb;
begin
  select id into v_sg from public.supplier_subgroups
  where group_code = 24450 and code_start = 500;  -- Insurance: 501..503 used
  v_res := public.add_supplier(v_sg, 'zz Great Eastern', 'test');
  perform public.t_assert(v_res->>'full_code' = '24450-504',
    'a new supplier takes the next number in its sub-group');
end $$;

-- ═══ The old diseases are refused at the door ═══
do $$
declare v_sg uuid; v_ok boolean := false;
begin
  select id into v_sg from public.supplier_subgroups
  where group_code = 24450 and code_start = 500;
  begin
    perform public.add_supplier(v_sg, 'zz great eastern', null);
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'the same name twice in one group is refused');

  v_ok := false;
  begin
    perform public.add_supplier(v_sg, 'TEKKA MANAGEMENT', null);
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok,
    'a known old QuickBooks spelling of an existing supplier is refused');
end $$;

-- ═══ Retiring keeps the code out of circulation ═══
do $$
declare v_id uuid; v_sg uuid; v_res jsonb;
begin
  select id, subgroup_id into v_id, v_sg from public.suppliers
  where name = 'zz Great Eastern';
  perform public.update_supplier(v_id, 'zz Great Eastern', null, 'retired');
  v_res := public.add_supplier(v_sg, 'zz AIA', null);
  perform public.t_assert(v_res->>'full_code' = '24450-505',
    'a retired supplier''s number is never reissued');
end $$;

-- ═══ A full block says so ═══
do $$
declare v_res jsonb; v_sg uuid; v_ok boolean := false; i int;
begin
  v_res := public.add_supplier_subgroup(24750, 'zz Tiny Block', 10);
  v_sg := (v_res->>'subgroup_id')::uuid;
  perform public.t_assert((v_res->>'code_start')::int % 10 = 0
    and (v_res->>'code_end')::int - (v_res->>'code_start')::int = 9,
    'a new sub-group claims an aligned free block');
  for i in 1..9 loop
    perform public.add_supplier(v_sg, 'zz Filler ' || i, null);
  end loop;
  begin
    perform public.add_supplier(v_sg, 'zz One Too Many', null);
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a full sub-group refuses the tenth supplier');
end $$;

-- ═══ Aliases route to one owner ═══
do $$
declare v_id uuid; v_ok boolean := false;
begin
  select id into v_id from public.suppliers where name = 'zz AIA';
  perform public.add_supplier_alias(v_id, 'zz OLD AIA SPELLING');
  begin
    perform public.add_supplier_alias(v_id, 'ZZ OLD AIA SPELLING');
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'an alias can only point at one supplier');
end $$;

-- ═══ Invisible outside the central team ═══
set role authenticated;
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- staff
select public.t_assert(
  not exists (select 1 from public.suppliers)
  and not exists (select 1 from public.supplier_aliases)
  and not exists (select 1 from public.supplier_groups),
  'staff cannot read the register at all');
do $$
declare v_sg uuid; v_ok boolean := false;
begin
  begin
    perform public.add_supplier(gen_random_uuid(), 'zz Sneaky', null);
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nor add to it');
end $$;
reset role;

-- Clean up.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.suppliers where name like 'zz %';
delete from public.supplier_subgroups where name like 'zz %';

reset test.uid;
select 'SUPPLIER REGISTER TESTS PASSED' as result;
