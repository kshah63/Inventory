-- 0024_block_out_of_stock_orders.sql
-- Out of stock means not orderable. Previously an order was a pre-order with
-- no stock check, so anything could be ordered and procurement was left to
-- source it — setting an expectation we don't want to set. Now create_order
-- refuses a line whose item has zero stock across every room. "Low" stock is
-- still fine; only a true zero is blocked. Staff are pointed at Requests
-- instead (in the app), so there's no implicit "we'll get it quickly" promise.
--
-- Only create_order changes. Re-runnable (create or replace).

create or replace function public.create_order(
  p_location_id uuid, p_zone text, p_lines jsonb, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_role text := public.current_user_role();
  v_order_id uuid;
  v_order_no bigint;
  v_line record;
  v_item public.items;
  v_on_hand int;
  v_total int := 0;
  v_count int := 0;
begin
  if v_role not in ('staff','dept_head','procurement','super_admin') then
    raise exception 'Not authorized.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Your order is empty.';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Pick a valid store room.';
  end if;

  insert into public.orders (requested_by, location_id, zone, note)
  values (auth.uid(), p_location_id, nullif(trim(coalesce(p_zone,'')), ''),
          nullif(trim(coalesce(p_note,'')), ''))
  returning id, order_no into v_order_id, v_order_no;

  -- Duplicate lines for the same item are merged first, so a limit of 5
  -- can't be beaten by ordering 3 and 3.
  for v_line in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by 1
  loop
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;
    select * into v_item from public.items
    where id = v_line.item_id and is_active
      and (not admin_only or public.is_admin());
    if v_item.id is null then
      raise exception 'Item not found.';
    end if;
    -- Out of stock means not orderable — raise it as a request instead.
    select coalesce(sum(qty_on_hand), 0) into v_on_hand
    from public.stock_levels where item_id = v_item.id;
    if v_on_hand <= 0 then
      raise exception '"%" is out of stock, so it can''t be ordered right now.', v_item.name;
    end if;
    if v_item.max_per_checkout is not null and v_line.qty > v_item.max_per_checkout then
      raise exception 'You can order at most % % of "%" at a time.',
        v_item.max_per_checkout, v_item.unit, v_item.name;
    end if;
    insert into public.order_lines (order_id, item_id, qty_requested)
    values (v_order_id, v_line.item_id, v_line.qty);
    v_total := v_total + v_line.qty;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_no', v_order_no,
    'total_units', v_total,
    'line_count', v_count,
    'requester_name', (select full_name from public.users where id = auth.uid()),
    'location_name', (select name from public.locations where id = p_location_id)
  );
end;
$$;

grant execute on function public.create_order(uuid, text, jsonb, text) to authenticated;
