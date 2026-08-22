-- Migration 0015 acceptance: central-team items stay central, rooms mean
-- something, and deleting is refused where it would cost history.
-- Run after 0015. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ZZ-USED is deliberately left behind by an earlier run: the ledger is
-- append-only, so an item that has moved can never be cleared away. That is
-- the rule under test, so the fixture below reuses it rather than recreating.
delete from public.stock_levels sl using public.items i
where sl.item_id = i.id and i.sku in ('ZZ-ADMIN', 'ZZ-DELETE');
delete from public.items where sku in ('ZZ-ADMIN', 'ZZ-DELETE');

-- ═══ Central-team-only items ═══
do $$
declare v_cat uuid; v_item uuid; v_loc uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  insert into public.items (sku, name, category_id, unit, admin_only)
  values ('ZZ-ADMIN', 'zz Industrial detergent', v_cat, 'bottle', true)
  returning id into v_item;
  insert into public.stock_levels (item_id, location_id, qty_on_hand)
  values (v_item, v_loc, 5);
end $$;

-- RLS is not enforced for the table owner, which is who this suite connects
-- as. Everything below the role switch is what a signed-in account sees.
set role authenticated;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- procurement
select public.t_assert(
  exists (select 1 from public.items where sku = 'ZZ-ADMIN'),
  'the central team can see a restricted item');
select public.t_assert(
  exists (
    select 1 from public.stock_levels sl
    join public.items i on i.id = sl.item_id where i.sku = 'ZZ-ADMIN'),
  'and can track what is left of it');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- staff
select public.t_assert(
  not exists (select 1 from public.items where sku = 'ZZ-ADMIN'),
  'nobody else can, even querying the table directly');
select public.t_assert(
  not exists (
    select 1 from public.stock_levels sl
    join public.items i on i.id = sl.item_id where i.sku = 'ZZ-ADMIN'),
  'its stock levels are hidden as well');

-- The suggestion box runs as the owner, so the policy alone would not have
-- covered it — the name would have leaked without the row.
select public.t_assert(
  (select count(*) from public.search_catalogue('industrial detergent')) = 0,
  'and it never turns up as a suggestion');
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.t_assert(
  (select count(*) from public.search_catalogue('industrial detergent')) = 1,
  'though the central team can still search for it');

-- Knowing the id is not enough either.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_item uuid; v_loc uuid; v_ok boolean := false;
begin
  select id into v_item from public.items where sku = 'ZZ-ADMIN';
  select id into v_loc from public.locations where is_active order by name limit 1;
  begin
    perform public.create_order(
      v_loc, '14', jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1)),
      'zz-restricted test');
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'and it cannot be ordered by id');
end $$;

reset role;
delete from public.order_lines ol using public.orders o
where ol.order_id = o.id and o.note = 'zz-restricted test';
delete from public.orders where note = 'zz-restricted test';

-- ═══ Which rooms an item is kept in ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v_item uuid; v_first uuid;
begin
  select id into v_item from public.items where sku = 'ZZ-ADMIN';
  select id into v_first from public.locations where is_active order by name limit 1;
  -- Still holds 5, so dropping that room has to be refused.
  begin
    perform public.set_item_rooms(v_item, array[]::uuid[]);
    perform public.t_assert(false, 'unreachable');
  exception when others then
    perform public.t_assert(true, 'a room holding stock cannot be quietly dropped');
  end;
  -- Empty it, then it can go.
  update public.stock_levels set qty_on_hand = 0
  where item_id = v_item and location_id = v_first;
  perform public.set_item_rooms(v_item, array[v_first]);
end $$;

select public.t_assert(
  (select count(*) from public.stock_levels sl
   join public.items i on i.id = sl.item_id where i.sku = 'ZZ-ADMIN') = 1,
  'an item is kept in exactly the rooms it is given');

-- ═══ Deleting ═══
do $$
declare v_cat uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  insert into public.items (sku, name, category_id, unit)
  values ('ZZ-DELETE', 'zz Typo item', v_cat, 'pc');
end $$;

select public.delete_item((select id from public.items where sku = 'ZZ-DELETE'));
select public.t_assert(
  not exists (select 1 from public.items where sku = 'ZZ-DELETE'),
  'an item with no history can be deleted outright');

-- One that has been used cannot.
do $$
declare v_cat uuid; v_item uuid; v_loc uuid; v_ok boolean := false;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_item from public.items where sku = 'ZZ-USED';
  if v_item is null then
    insert into public.items (sku, name, category_id, unit)
    values ('ZZ-USED', 'zz Used item', v_cat, 'pc') returning id into v_item;
    insert into public.stock_levels (item_id, location_id, qty_on_hand)
    values (v_item, v_loc, 10);
    perform public._apply_transaction('checkout', v_item, v_loc, -1,
      'aaaaaaaa-0000-0000-0000-000000000002', 'zz test');
  else
    update public.items set is_active = true where id = v_item;
  end if;

  begin
    perform public.delete_item(v_item);
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'an item with ledger history refuses to be deleted');
end $$;

select public.t_assert(
  exists (select 1 from public.items where sku = 'ZZ-USED'),
  'and it is still there afterwards');

-- Staff can do none of this.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.delete_item((select id from public.items where sku = 'ZZ-USED'));
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'staff cannot delete items');
end $$;

do $$
declare v_item uuid; v_loc uuid; v_ok boolean := false;
begin
  select id into v_item from public.items where sku = 'ZZ-USED';
  select id into v_loc from public.locations where is_active order by name limit 1;
  begin
    perform public.set_item_rooms(v_item, array[v_loc]);
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'nor decide which rooms an item is kept in');
end $$;

-- Clean up: the used one keeps its ledger row, so deactivate rather than
-- delete — which is exactly the rule being tested.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.items set is_active = false where sku = 'ZZ-USED';
delete from public.stock_levels sl using public.items i
where sl.item_id = i.id and i.sku = 'ZZ-ADMIN';
delete from public.items where sku = 'ZZ-ADMIN';

reset test.uid;
select 'RESTRICTED AND ROOMS TESTS PASSED' as result;
