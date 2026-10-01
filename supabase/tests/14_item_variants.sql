-- Migration 0023 acceptance: items can be grouped into variants, each variant
-- is still an ordinary stockable item, combinations are unique, and only
-- admins build groups. Run after 0023. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

delete from public.items where sku like 'ZZV-%';
delete from public.item_groups where name like 'zz %';

insert into public.categories (name, sort_order)
select 'zz Variants', 999
where not exists (select 1 from public.categories where name = 'zz Variants');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- procurement (admin)

-- ═══ A group with two attributes, variants as ordinary items ═══
do $$
declare v_cat uuid; v_g uuid;
begin
  select id into v_cat from public.categories where name = 'zz Variants';
  v_g := public.save_item_group(null, 'zz Gel Pen', v_cat, 'Size', 'Colour', true);
  perform public.t_assert(v_g is not null, 'a group is created with two attributes');
  insert into public.items (sku, name, category_id, group_id, attr1_value, attr2_value)
  values ('ZZV-1', 'zz Gel Pen 0.5 Blue', v_cat, v_g, '0.5mm', 'Blue'),
         ('ZZV-2', 'zz Gel Pen 0.5 Red',  v_cat, v_g, '0.5mm', 'Red');
  perform public.t_assert(
    (select count(*) from public.items where group_id = v_g) = 2,
    'variants sit under the group as ordinary stockable items');
end $$;

-- ═══ No two variants share a combination ═══
do $$
declare v_cat uuid; v_g uuid; v_ok boolean := false;
begin
  select id into v_cat from public.categories where name = 'zz Variants';
  select id into v_g from public.item_groups where name = 'zz Gel Pen';
  begin
    insert into public.items (sku, name, category_id, group_id, attr1_value, attr2_value)
    values ('ZZV-3', 'zz dup', v_cat, v_g, '0.5mm', 'Blue');
  exception when unique_violation then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'two variants cannot share the same combination');
end $$;

-- ═══ A grouped item must name its first attribute ═══
do $$
declare v_cat uuid; v_g uuid; v_ok boolean := false;
begin
  select id into v_cat from public.categories where name = 'zz Variants';
  select id into v_g from public.item_groups where name = 'zz Gel Pen';
  begin
    insert into public.items (sku, name, category_id, group_id, attr1_value)
    values ('ZZV-4', 'zz no attr', v_cat, v_g, null);
  exception when check_violation then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'a variant without its first attribute is refused');
end $$;

-- ═══ Folding an existing item into a group, and back out ═══
do $$
declare v_cat uuid; v_g uuid; v_item uuid;
begin
  select id into v_cat from public.categories where name = 'zz Variants';
  select id into v_g from public.item_groups where name = 'zz Gel Pen';
  insert into public.items (sku, name, category_id) values ('ZZV-5', 'zz loose pen', v_cat)
    returning id into v_item;
  perform public.assign_items_to_group(v_g, jsonb_build_array(
    jsonb_build_object('item_id', v_item, 'attr1_value', '0.7mm', 'attr2_value', 'Black')));
  perform public.t_assert(
    (select group_id from public.items where id = v_item) = v_g
    and (select attr1_value from public.items where id = v_item) = '0.7mm'
    and (select attr2_value from public.items where id = v_item) = 'Black',
    'an existing item can be folded into a group with its values');
  perform public.ungroup_item(v_item);
  perform public.t_assert(
    (select group_id from public.items where id = v_item) is null
    and (select attr1_value from public.items where id = v_item) is null,
    'and taken back out again');
end $$;

-- ═══ Staff may read groups but not build them ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';  -- staff
do $$
declare v_cat uuid; v_ok boolean := false;
begin
  select id into v_cat from public.categories where name = 'zz Variants';
  perform public.t_assert(
    (select count(*) from public.item_groups where name = 'zz Gel Pen') = 1,
    'staff can see groups, to pick a variant in the catalogue');
  begin
    perform public.save_item_group(null, 'zz sneaky', v_cat, 'Colour', null, true);
  exception when others then v_ok := true;
  end;
  perform public.t_assert(v_ok, 'but staff cannot create one');
end $$;

-- cleanup
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.items where sku like 'ZZV-%';
delete from public.item_groups where name like 'zz %';

select 'ITEM VARIANT TESTS PASSED' as result;
