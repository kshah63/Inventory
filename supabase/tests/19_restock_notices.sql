-- Migration 0029 acceptance: when an item people were interested in comes back
-- into stock, they're notified and the interest tally is cleared. Run after
-- 0029. Re-runnable.
--
-- The trigger fires on any increase of stock_levels.qty_on_hand — which is the
-- single update every restock path (receive, adjustment, transfer, stocktake)
-- performs — so the tests drive it with a direct update, rather than writing
-- immutable ledger rows against throwaway items.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.restock_notices rn using public.items i
where rn.item_id = i.id and i.sku like 'ZZN-%';
delete from public.item_interest ii using public.items i
where ii.item_id = i.id and i.sku like 'ZZN-%';
delete from public.stock_levels where item_id in (select id from public.items where sku like 'ZZN-%');
delete from public.items where sku like 'ZZN-%';

insert into public.users (id, full_name, role, user_no) values
  ('aaaaaaaa-0000-0000-0000-000000000062', 'zz Waiter', 'staff', 9962)
on conflict (id) do nothing;

-- Item A is out of stock; item B still has some on the shelf.
do $$
declare v_cat uuid; v_loc uuid; v_a uuid; v_b uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  insert into public.items (sku, name, category_id) values ('ZZN-A', 'zz Notify Pen A', v_cat) returning id into v_a;
  insert into public.items (sku, name, category_id) values ('ZZN-B', 'zz Notify Pen B', v_cat) returning id into v_b;
  insert into public.stock_levels (item_id, location_id, qty_on_hand) values (v_a, v_loc, 0);
  insert into public.stock_levels (item_id, location_id, qty_on_hand) values (v_b, v_loc, 5);
end $$;

-- Two people express interest in the out-of-stock A; one in B.
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
select public.express_interest((select id from public.items where sku = 'ZZN-A'));
select public.express_interest((select id from public.items where sku = 'ZZN-B'));
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000062';
select public.express_interest((select id from public.items where sku = 'ZZN-A'));

select public.t_assert(
  (select count(*) from public.item_interest
   where item_id = (select id from public.items where sku = 'ZZN-A')) = 2,
  'two people are on the interest tally for the out-of-stock item');

-- ═══ A comes back into stock (0 → 12) ═══
update public.stock_levels set qty_on_hand = 12
where item_id = (select id from public.items where sku = 'ZZN-A');

select public.t_assert(
  (select count(*) from public.item_interest
   where item_id = (select id from public.items where sku = 'ZZN-A')) = 0,
  'restocking clears the interest tally, so it no longer reads as unmet demand');
select public.t_assert(
  (select count(*) from public.restock_notices
   where item_id = (select id from public.items where sku = 'ZZN-A') and seen_at is null) = 2,
  'both interested people get an unseen "back in stock" notice');

-- ═══ Dismissing is per person ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
select public.mark_restock_notices_seen();
select public.t_assert(
  (select seen_at from public.restock_notices
   where item_id = (select id from public.items where sku = 'ZZN-A')
     and user_id = 'aaaaaaaa-0000-0000-0000-000000000002') is not null,
  'dismissing marks only my own notice seen');
select public.t_assert(
  (select seen_at from public.restock_notices
   where item_id = (select id from public.items where sku = 'ZZN-A')
     and user_id = 'aaaaaaaa-0000-0000-0000-000000000062') is null,
  'someone else''s notice is untouched');

-- ═══ A top-up that doesn't cross zero leaves interest alone ═══
-- B already had 5 on the shelf; receiving 3 more is not a come-back.
update public.stock_levels set qty_on_hand = 8
where item_id = (select id from public.items where sku = 'ZZN-B');

select public.t_assert(
  (select count(*) from public.item_interest
   where item_id = (select id from public.items where sku = 'ZZN-B')) = 1,
  'topping up an item that was already in stock does not clear its interest');
select public.t_assert(
  (select count(*) from public.restock_notices
   where item_id = (select id from public.items where sku = 'ZZN-B')) = 0,
  'and raises no back-in-stock notice');

-- cleanup
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.restock_notices rn using public.items i
where rn.item_id = i.id and i.sku like 'ZZN-%';
delete from public.item_interest ii using public.items i
where ii.item_id = i.id and i.sku like 'ZZN-%';
delete from public.stock_levels where item_id in (select id from public.items where sku like 'ZZN-%');
delete from public.items where sku like 'ZZN-%';
delete from public.users where id = 'aaaaaaaa-0000-0000-0000-000000000062';

reset test.uid;
select 'RESTOCK NOTICES TESTS PASSED' as result;
