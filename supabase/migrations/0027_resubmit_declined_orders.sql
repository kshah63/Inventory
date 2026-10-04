-- 0027_resubmit_declined_orders.sql
-- A declined order or bought-in request can be corrected and resubmitted,
-- instead of being raised again from scratch — the same courtesy a declined
-- reimbursement already has (0022). Editing a declined one addresses the
-- reason it was turned down and sends it back:
--   • an order returns to 'pending' (procurement's note cleared),
--   • a request returns to 'open' (procurement's note cleared).
-- Anything already in flight (being packed / on order) still can't be edited —
-- the counting is physical by then, and a note is the right channel.
--
-- Safe to run on a live database and only needs running once. Re-runnable:
-- every statement is create-or-replace.

-- ── edit_order now also covers a declined order, and resubmits it ──────────
-- (supersedes the 0015 version, which allowed 'pending' only.)
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
  v_was_rejected boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  -- Yours to change, or procurement acting for you.
  if v_order.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  -- Pending (still yours to change) or declined (being corrected and
  -- resubmitted). Once procurement starts packing, the counting is physical
  -- and an edit underneath them would be wrong, so it stops there.
  if v_order.status not in ('pending', 'rejected') then
    raise exception 'Order #% is already being packed — cancel it instead.', v_order.order_no;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one item. Cancel it instead.';
  end if;

  v_was_rejected := v_order.status = 'rejected';

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
    select * into v_item from public.items
    where id = v_line.item_id and is_active
      and (not admin_only or public.is_admin());
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

  -- A declined order that's been corrected goes back for review: it returns
  -- to pending and procurement's note is wiped. The status trigger restamps
  -- it as the requester, so it won't flag as "updated" to them. A pending
  -- edit leaves the status and note untouched.
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

-- ── edit_request: correct a request, and resubmit it if it was declined ────
-- There was no requester-facing request edit before (only update_request_qty
-- for the quantity). This lets the requester fix the item, description, link,
-- photo, quantity and zone in one go, and a declined request returns to open.
create or replace function public.edit_request(
  p_request_id uuid,
  p_item_name  text,
  p_description text,
  p_product_url text,
  p_photo_url  text,
  p_qty        int,
  p_zone       text
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_request public.requests;
  v_was_rejected boolean;
begin
  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  -- Still open (not yet ordered) can be corrected; a declined one can be
  -- corrected and resubmitted. Once it's on order or further along, a note is
  -- the right channel, not an edit.
  if v_request.status not in ('open', 'acknowledged', 'rejected') then
    raise exception 'That request is already being dealt with — add a note instead.';
  end if;
  if nullif(trim(coalesce(p_item_name, '')), '') is null then
    raise exception 'Tell us what you need.';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be at least 1.';
  end if;

  v_was_rejected := v_request.status = 'rejected';

  update public.requests
  set free_text_item = trim(p_item_name),
      description     = nullif(trim(coalesce(p_description, '')), ''),
      product_url     = nullif(trim(coalesce(p_product_url, '')), ''),
      photo_url       = nullif(trim(coalesce(p_photo_url, '')), ''),
      qty             = p_qty,
      zone            = nullif(trim(coalesce(p_zone, '')), ''),
      -- Correcting a declined request resubmits it: back to open, note wiped.
      status          = case when v_was_rejected then 'open' else status end,
      admin_note      = case when v_was_rejected then null else admin_note end,
      updated_at      = now()
  where id = p_request_id;

  return jsonb_build_object(
    'resubmitted', v_was_rejected,
    'status', case when v_was_rejected then 'open' else v_request.status end
  );
end;
$$;

grant execute on function public.edit_request(uuid, text, text, text, text, int, text)
  to authenticated;
