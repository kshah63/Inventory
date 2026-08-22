-- Migration 0019 acceptance: one number per item decides what to buy, it is
-- counted across rooms, and leaving it blank means untracked rather than
-- silently broken. Run after 0019. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.stock_levels sl using public.items i
where sl.item_id = i.id and i.sku in ('ZZ-KEEP', 'ZZ-UNTRACKED');
delete from public.items where sku in ('ZZ-KEEP', 'ZZ-UNTRACKED');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- procurement

-- Kept in both rooms: 4 in one, 4 in the other, and we like to have 20.
do $$
declare v_cat uuid; v_item uuid; v_a uuid; v_b uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  select id into v_a from public.locations where is_active order by name limit 1;
  select id into v_b from public.locations where is_active order by name desc limit 1;

  insert into public.items (sku, name, category_id, unit, keep_about)
  values ('ZZ-KEEP', 'zz Kept item', v_cat, 'pcs', 20) returning id into v_item;
  insert into public.stock_levels (item_id, location_id, qty_on_hand)
  values (v_item, v_a, 4);
  if v_b <> v_a then
    insert into public.stock_levels (item_id, location_id, qty_on_hand)
    values (v_item, v_b, 4);
  end if;

  -- Nobody restocks this one, so it has no number at all.
  insert into public.items (sku, name, category_id, unit)
  values ('ZZ-UNTRACKED', 'zz Untracked item', v_cat, 'pcs');
end $$;

-- ═══ 8 of 20 is under half, so it needs buying — and 12 of them ═══
select public.t_assert(
  exists (select 1 from public.get_reorder_dashboard() where sku = 'ZZ-KEEP'),
  'an item under half of what we keep needs reordering');

select public.t_assert(
  (select qty_on_hand from public.get_reorder_dashboard() where sku = 'ZZ-KEEP') = 8,
  'its count is totalled across every room');

select public.t_assert(
  (select suggested_qty from public.get_reorder_dashboard() where sku = 'ZZ-KEEP') = 12,
  'and the suggestion tops it back up to the number');

-- ═══ Comfortably stocked is not a reorder ═══
update public.stock_levels set qty_on_hand = 9
where item_id = (select id from public.items where sku = 'ZZ-KEEP');

select public.t_assert(
  not exists (select 1 from public.get_reorder_dashboard() where sku = 'ZZ-KEEP'),
  'above half, it stays off the list');

-- ═══ No number means nobody is tracking it, not "reorder at zero" ═══
select public.t_assert(
  not exists (select 1 from public.get_reorder_dashboard() where sku = 'ZZ-UNTRACKED'),
  'an item with no number never appears, even at zero');

-- ═══ The dashboard counts the same way the list does ═══
do $$
declare v_low int; v_listed int;
begin
  update public.stock_levels set qty_on_hand = 1
  where item_id = (select id from public.items where sku = 'ZZ-KEEP');

  select (public.get_dashboard_stats()->>'low_stock')::int into v_low;
  select count(*) from public.get_reorder_dashboard() into v_listed;
  perform public.t_assert(v_low = v_listed,
    'the dashboard low-stock count matches the reorder list exactly');
end $$;

-- ...but out of stock needs no target: having none is true either way.
select public.t_assert(
  (select (public.get_dashboard_stats()->>'out_of_stock')::int) =
  (select count(*) from public.items i
   where i.is_active
     and coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
                   where sl.item_id = i.id), 0) = 0),
  'out of stock counts every item at zero, tracked or not');

-- ═══ Only procurement decides what we keep ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- staff
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.get_reorder_dashboard();
  exception when others then
    v_ok := true;
  end;
  perform public.t_assert(v_ok, 'staff cannot read the reorder list');
end $$;

-- Clean up.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.stock_levels sl using public.items i
where sl.item_id = i.id and i.sku in ('ZZ-KEEP', 'ZZ-UNTRACKED');
delete from public.items where sku in ('ZZ-KEEP', 'ZZ-UNTRACKED');

reset test.uid;
select 'KEEP ABOUT TESTS PASSED' as result;
