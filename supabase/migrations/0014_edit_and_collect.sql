-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0014 — Fix your own order, and tick your own collection
--
--   • edit_order() — change quantities or drop a line while the order is
--     still pending. Once procurement starts packing, the counting is
--     physical and an edit underneath them would be wrong, so it stops.
--   • collect_order() — the person collecting can now tick it themselves.
--     They're the one who knows. Procurement keeps the ability for when
--     somebody forgets.
--   • update_request_qty() — the same second thought on a request.
-- Run once, after 0013. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Change an order while it is still pending.
create or replace function public.edit_order(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_order public.orders;
  v_line record;
  v_item public.items;
  v_total int := 0;
  v_count int := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  -- Yours to change, or procurement acting for you.
  if v_order.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Order #% is already being packed — cancel it instead.', v_order.order_no;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one item. Cancel it instead.';
  end if;

  -- Rebuild the lines from what was sent, so removing one is just leaving
  -- it out. Merged by item first, so a per-item cap can't be split.
  delete from public.order_lines where order_id = p_order_id;

  for v_line in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by 1
  loop
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;
    select * into v_item from public.items where id = v_line.item_id and is_active;
    if v_item.id is null then
      raise exception 'Item not found.';
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

  update public.orders set updated_at = now() where id = p_order_id;

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'total_units', v_total,
    'line_count', v_count
  );
end;
$$;

grant execute on function public.edit_order(uuid, jsonb) to authenticated;

-- 2. Whoever collects can tick it.
create or replace function public.collect_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  -- The person picking it up knows it happened; procurement can tick it
  -- too, for when somebody forgets.
  if v_order.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_order.status <> 'ready' then
    raise exception 'Only orders that are ready can be marked collected.';
  end if;

  update public.orders
  set status = 'collected', collected_at = now()
  where id = p_order_id;
end;
$$;

-- 3. Second thoughts on a request, while it is still open.
create or replace function public.update_request_qty(p_request_id uuid, p_qty int)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_request public.requests;
begin
  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_request.status not in ('open','acknowledged') then
    raise exception 'That request is already being dealt with — add a note instead.';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be at least 1.';
  end if;

  update public.requests set qty = p_qty where id = p_request_id;
end;
$$;

grant execute on function public.update_request_qty(uuid, int) to authenticated;
