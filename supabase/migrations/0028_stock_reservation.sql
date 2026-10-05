-- 0028_stock_reservation.sql
-- Stock that's already in a pending order is spoken for, even though it hasn't
-- physically moved yet. Until now two people could each be offered the same
-- last-of-the-stock, because availability was read straight off qty_on_hand
-- and an order doesn't decrement stock until procurement packs it. Now an
-- item's *available* quantity is what's on hand minus what pending (placed,
-- not yet packed/collected) orders already hold — first come, first served.
--
--   available = sum(qty_on_hand)  −  sum(qty_requested in pending orders)
--
-- A packed order ('ready') has already come off qty_on_hand and left the
-- pending set, so it's never double-counted. Cancelled and declined orders
-- hold nothing.
--
-- Changes create_order (reject over-ordering), edit_order (same, on the
-- resubmit/edit path) and adds item_committed_qty() so the catalogue can show
-- the reduced number. Re-runnable (create or replace).

-- ── What pending orders already hold, per item ─────────────────────────────
-- Security definer, because a staff member can't read other people's orders
-- under RLS — but they must see that the shelf is spoken for. Only aggregate
-- quantities are exposed, never who ordered.
create or replace function public.item_committed_qty()
returns table (item_id uuid, committed int)
language sql stable security definer set search_path = public, extensions
as $$
  select ol.item_id, sum(ol.qty_requested)::int
  from public.order_lines ol
  join public.orders o on o.id = ol.order_id
  where o.status = 'pending'
  group by ol.item_id;
$$;

grant execute on function public.item_committed_qty() to authenticated;

-- ── create_order: never promise stock a pending order already holds ────────
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
  v_committed int;
  v_available int;
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
  -- can't be beaten by ordering 3 and 3. Ordered by item id so concurrent
  -- orders lock items in the same sequence and can't deadlock.
  for v_line in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by 1
    order by 1
  loop
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;
    -- Lock the item row so two orders can't both claim the last of the stock:
    -- the second waits, then reads the first one's reservation below.
    select * into v_item from public.items
    where id = v_line.item_id and is_active
      and (not admin_only or public.is_admin())
    for update;
    if v_item.id is null then
      raise exception 'Item not found.';
    end if;

    select coalesce(sum(qty_on_hand), 0) into v_on_hand
    from public.stock_levels where item_id = v_item.id;
    -- What pending orders already hold. This order's own line isn't inserted
    -- yet, so it isn't counted.
    select coalesce(sum(ol.qty_requested), 0) into v_committed
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id
    where o.status = 'pending' and ol.item_id = v_item.id;
    v_available := v_on_hand - v_committed;

    if v_on_hand <= 0 then
      raise exception '"%" is out of stock, so it can''t be ordered right now.', v_item.name;
    end if;
    if v_available <= 0 then
      raise exception 'Every "%" we have is already in an order waiting to be collected, so there''s none to order right now.',
        v_item.name;
    end if;
    if v_line.qty > v_available then
      raise exception 'Only % % of "%" can be ordered right now — the rest are in orders waiting to be collected.',
        v_available, v_item.unit, v_item.name;
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

-- ── edit_order: the same ceiling on the edit / resubmit path ───────────────
-- (supersedes 0027.) Rebuilds the lines, and a declined order resubmits. The
-- order's own current lines are deleted first, so they don't count against its
-- own availability.
create or replace function public.edit_order(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_order public.orders;
  v_line record;
  v_item public.items;
  v_on_hand int;
  v_committed int;
  v_available int;
  v_total int := 0;
  v_count int := 0;
  v_was_rejected boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  if v_order.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_order.status not in ('pending', 'rejected') then
    raise exception 'Order #% is already being packed — cancel it instead.', v_order.order_no;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one item. Cancel it instead.';
  end if;

  v_was_rejected := v_order.status = 'rejected';

  delete from public.order_lines where order_id = p_order_id;

  for v_line in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by 1
    order by 1
  loop
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;
    select * into v_item from public.items
    where id = v_line.item_id and is_active
      and (not admin_only or public.is_admin())
    for update;
    if v_item.id is null then
      raise exception 'Item not found.';
    end if;

    select coalesce(sum(qty_on_hand), 0) into v_on_hand
    from public.stock_levels where item_id = v_item.id;
    -- This order's lines are already deleted above, so a pending order being
    -- edited doesn't count against itself.
    select coalesce(sum(ol.qty_requested), 0) into v_committed
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id
    where o.status = 'pending' and ol.item_id = v_item.id;
    v_available := v_on_hand - v_committed;

    if v_on_hand <= 0 then
      raise exception '"%" is out of stock, so it can''t be ordered right now.', v_item.name;
    end if;
    if v_available <= 0 then
      raise exception 'Every "%" we have is already in an order waiting to be collected, so there''s none to order right now.',
        v_item.name;
    end if;
    if v_line.qty > v_available then
      raise exception 'Only % % of "%" can be ordered right now — the rest are in orders waiting to be collected.',
        v_available, v_item.unit, v_item.name;
    end if;
    if v_item.max_per_checkout is not null and v_line.qty > v_item.max_per_checkout then
      raise exception 'You can order at most % % of "%" at a time.',
        v_item.max_per_checkout, v_item.unit, v_item.name;
    end if;
    insert into public.order_lines (order_id, item_id, qty_requested)
    values (p_order_id, v_line.item_id, v_line.qty);
    v_total := v_total + v_line.qty;
    v_count := v_count + 1;
  end loop;

  update public.orders
  set status = case when v_was_rejected then 'pending' else status end,
      admin_note = case when v_was_rejected then null else admin_note end,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'total_units', v_total,
    'line_count', v_count,
    'resubmitted', v_was_rejected
  );
end;
$$;

grant execute on function public.edit_order(uuid, jsonb) to authenticated;
