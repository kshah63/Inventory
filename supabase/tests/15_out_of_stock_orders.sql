-- Migration 0024 acceptance: an out-of-stock item cannot be ordered, while a
-- low-but-nonzero item still can. Run after 0024. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.orders where note like 'zz-oos%';
delete from public.stock_levels where item_id in (select id from public.items where sku like 'ZZO-%');
delete from public.items where sku like 'ZZO-%';

-- One item kept low (3 on hand, likes to keep 10), one at a true zero.
do $$
declare v_cat uuid; v_loc uuid; v_in uuid; v_out uuid;
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  select id into v_loc from public.locations where is_active order by name limit 1;
  insert into public.items (sku, name, category_id, keep_about)
    values ('ZZO-IN', 'zz In Stock Pen', v_cat, 10) returning id into v_in;
  insert into public.items (sku, name, category_id)
    values ('ZZO-OUT', 'zz Out Of Stock Pen', v_cat) returning id into v_out;
  insert into public.stock_levels (item_id, location_id, qty_on_hand) values (v_in, v_loc, 3);
  insert into public.stock_levels (item_id, location_id, qty_on_hand) values (v_out, v_loc, 0);
end $$;

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- staff

-- ═══ Low but in stock: still orderable ═══
do $$
declare v_loc uuid; v_in uuid; v_res jsonb;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_in from public.items where sku = 'ZZO-IN';
  v_res := public.create_order(v_loc, '14',
    jsonb_build_array(jsonb_build_object('item_id', v_in, 'qty', 1)), 'zz-oos in');
  perform public.t_assert((v_res->>'line_count')::int = 1,
    'a low-but-in-stock item can still be ordered');
end $$;

-- ═══ Out of stock: refused ═══
do $$
declare v_loc uuid; v_out uuid; v_ok boolean := false;
begin
  select id into v_loc from public.locations where is_active order by name limit 1;
  select id into v_out from public.items where sku = 'ZZO-OUT';
  begin
    perform public.create_order(v_loc, '14',
      jsonb_build_array(jsonb_build_object('item_id', v_out, 'qty', 1)), 'zz-oos out');
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'an out-of-stock item cannot be ordered');
  perform public.t_assert(
    not exists (select 1 from public.orders where note = 'zz-oos out'),
    'and the refused order leaves nothing behind');
end $$;

-- cleanup
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.orders where note like 'zz-oos%';
delete from public.stock_levels where item_id in (select id from public.items where sku like 'ZZO-%');
delete from public.items where sku like 'ZZO-%';

select 'OUT OF STOCK ORDER TESTS PASSED' as result;
