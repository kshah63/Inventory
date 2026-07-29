-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0002 — Zones, zone reporting, and the ORDER → PACK → COLLECT flow
--
-- Pilot learnings baked in:
--  • Every stock movement records which Zone it was for (replacing
--    per-person departments); reports group by zone.
--  • The procurement room stays locked: zone admins pre-order from their own
--    device (§8 orders), procurement packs and records the checkout, the
--    requester just collects. No self-logging.
-- Run the whole file once, after 0001. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Zone column on the ledger (checkouts only; null elsewhere).
alter table public.transactions add column if not exists zone text;

-- 2. Configurable zone list (from the pilot tool), readable by every
--    signed-in role — the kiosk needs it at checkout.
insert into public.settings (key, value) values (
  'zones',
  '["Zone 3","Zone 4","Zone 5","Zone 6","Zone 9","Zone 10","Zone 11","Zone 12","Zone 14","Zone 15-16","Zone 17-19","Zone 20-22"]'::jsonb
) on conflict (key) do nothing;

drop policy if exists settings_zones_read on public.settings;
create policy settings_zones_read on public.settings
  for select to authenticated using (key = 'zones');

-- 3. _apply_transaction learns an optional zone (ledger rows are immutable,
--    so the value must be written at insert time).
drop function if exists public._apply_transaction(text, uuid, uuid, int, uuid, text, uuid, uuid);
create function public._apply_transaction(
  p_type text,
  p_item_id uuid,
  p_location_id uuid,
  p_qty_delta int,
  p_user_id uuid,
  p_note text default null,
  p_on_behalf_of uuid default null,
  p_transfer_group uuid default null,
  p_zone text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_qty int;
  v_item record;
  v_loc_name text;
  v_tx_id uuid;
begin
  if p_qty_delta = 0 then
    raise exception 'Quantity cannot be zero.';
  end if;

  select id, name, is_active into v_item from public.items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Item not found.';
  end if;

  insert into public.stock_levels (item_id, location_id)
  values (p_item_id, p_location_id)
  on conflict (item_id, location_id) do nothing;

  select qty_on_hand into v_qty
  from public.stock_levels
  where item_id = p_item_id and location_id = p_location_id
  for update;

  if v_qty + p_qty_delta < 0 then
    select name into v_loc_name from public.locations where id = p_location_id;
    if v_qty = 0 then
      raise exception 'Someone just took the last ones — 0 left of "%" at %.', v_item.name, v_loc_name;
    end if;
    raise exception 'Only % left of "%" at %.', v_qty, v_item.name, v_loc_name;
  end if;

  insert into public.transactions
    (type, item_id, location_id, qty_delta, user_id, on_behalf_of, note, transfer_group, zone)
  values
    (p_type, p_item_id, p_location_id, p_qty_delta, p_user_id, p_on_behalf_of,
     nullif(trim(coalesce(p_note,'')), ''), p_transfer_group,
     nullif(trim(coalesce(p_zone,'')), ''))
  returning id into v_tx_id;

  update public.stock_levels
  set qty_on_hand = qty_on_hand + p_qty_delta
  where item_id = p_item_id and location_id = p_location_id;

  return v_tx_id;
end;
$$;

revoke execute on function public._apply_transaction(text, uuid, uuid, int, uuid, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 4. kiosk_checkout asks "which zone is this for?" and stamps every line.
drop function if exists public.kiosk_checkout(uuid, jsonb);
create function public.kiosk_checkout(p_token uuid, p_lines jsonb, p_zone text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_session public.kiosk_sessions;
  v_line jsonb;
  v_item public.items;
  v_qty int;
  v_lines jsonb;
  v_taken jsonb := '[]'::jsonb;
  v_zero jsonb := '[]'::jsonb;
  v_remaining int;
  v_other jsonb;
begin
  v_session := public._get_kiosk_session(p_token);

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing to check out.';
  end if;

  -- Merge duplicate lines per item so max_per_checkout applies to the item
  -- TOTAL, and order by item so concurrent checkouts lock rows consistently.
  select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'qty', s.qty) order by s.item_id)
  into v_lines
  from (
    select e->>'item_id' as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by 1
  ) s;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    select * into v_item from public.items where id = (v_line->>'item_id')::uuid;
    if v_item.id is null or not v_item.is_active then
      raise exception 'Item not found.';
    end if;
    if v_item.requires_approval then
      raise exception '"%" requires approval — use the Request approval button.', v_item.name;
    end if;
    if v_item.max_per_checkout is not null and v_qty > v_item.max_per_checkout then
      raise exception 'Max % % of "%" per checkout.', v_item.max_per_checkout, v_item.unit, v_item.name;
    end if;

    perform public._apply_transaction(
      'checkout', v_item.id, v_session.location_id, -v_qty, v_session.user_id,
      null, null, null, p_zone);

    v_taken := v_taken || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'unit', v_item.unit, 'qty', v_qty);

    select qty_on_hand into v_remaining
    from public.stock_levels
    where item_id = v_item.id and location_id = v_session.location_id;

    if v_remaining = 0 then
      select coalesce(jsonb_agg(jsonb_build_object('location', l.name, 'qty', sl.qty_on_hand)), '[]'::jsonb)
      into v_other
      from public.stock_levels sl
      join public.locations l on l.id = sl.location_id
      where sl.item_id = v_item.id and sl.location_id <> v_session.location_id and sl.qty_on_hand > 0;

      v_zero := v_zero || jsonb_build_object(
        'item_id', v_item.id, 'name', v_item.name,
        'location', (select name from public.locations where id = v_session.location_id),
        'elsewhere', v_other);
    end if;
  end loop;

  update public.kiosk_sessions set expires_at = now() + interval '5 minutes'
  where token = p_token;

  return jsonb_build_object('taken', v_taken, 'hit_zero', v_zero);
end;
$$;

-- 5. Zone in the audit view (appended column — existing readers unaffected).
create or replace view public.v_transactions
with (security_invoker = on)
as
select
  t.id, t.type, t.qty_delta, t.note, t.transfer_group, t.created_at,
  t.item_id, i.sku, i.name as item_name, i.unit,
  t.location_id, l.name as location_name,
  t.user_id,
  coalesce(
    case when u.is_active then u.full_name else 'Former staff — ' || u.full_name end,
    'Staff member'
  ) as user_name,
  t.on_behalf_of,
  ob.full_name as on_behalf_of_name,
  c.name as category_name,
  t.zone
from public.transactions t
join public.items i on i.id = t.item_id
join public.categories c on c.id = i.category_id
join public.locations l on l.id = t.location_id
left join public.users u on u.id = t.user_id
left join public.users ob on ob.id = t.on_behalf_of;

grant select on public.v_transactions to authenticated;

-- 6. Consumption report can group by zone.
drop function if exists public.report_consumption(timestamptz, timestamptz, text);
create function public.report_consumption(
  p_from timestamptz, p_to timestamptz, p_group_by text
) returns table (group_key text, group_label text, total_qty bigint, tx_count bigint)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  if p_group_by not in ('user','item','category','department','location','zone') then
    raise exception 'Invalid grouping.';
  end if;
  return query
  select
    case p_group_by
      when 'user' then u.id::text
      when 'item' then i.id::text
      when 'category' then c.id::text
      when 'department' then coalesce(u.department, '—')
      when 'location' then l.id::text
      when 'zone' then coalesce(t.zone, '—')
    end,
    case p_group_by
      when 'user' then u.full_name || case when not u.is_active then ' (former staff)' else '' end
      when 'item' then i.name
      when 'category' then c.name
      when 'department' then coalesce(u.department, 'No department')
      when 'location' then l.name
      when 'zone' then coalesce(t.zone, 'No zone recorded')
    end,
    sum(-t.qty_delta)::bigint,
    count(*)::bigint
  from public.transactions t
  join public.users u on u.id = t.user_id
  join public.items i on i.id = t.item_id
  join public.categories c on c.id = i.category_id
  join public.locations l on l.id = t.location_id
  where t.type in ('checkout','return')
    and t.created_at >= p_from and t.created_at < p_to
  group by 1, 2
  having sum(-t.qty_delta) <> 0
  order by 3 desc;
end;
$$;

-- 7. Dashboard: count of requests ordered & awaiting delivery.
create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'low_stock', (select count(*) from public.stock_levels sl
                  join public.items i on i.id = sl.item_id and i.is_active
                  where sl.reorder_point > 0 and sl.qty_on_hand <= sl.reorder_point),
    'out_of_stock', (select count(*) from public.stock_levels sl
                     join public.items i on i.id = sl.item_id and i.is_active
                     where sl.reorder_point > 0 and sl.qty_on_hand = 0),
    'open_requests', (select count(*) from public.requests where status in ('open','acknowledged')),
    'ordered_requests', (select count(*) from public.requests where status = 'ordered'),
    'pending_approvals', (select count(*) from public.pending_checkouts where status = 'pending'),
    'checkouts_today', (select coalesce(sum(-qty_delta), 0) from public.transactions
                        where type = 'checkout'
                          and created_at >= date_trunc('day', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore'),
    'top_movers_week', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select i.name, sum(-t.qty_delta) as qty
      from public.transactions t
      join public.items i on i.id = t.item_id
      where t.type = 'checkout' and t.created_at > now() - interval '7 days'
      group by i.name
      order by qty desc
      limit 5
    ) x)
  ) into v_result;
  return v_result;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. ORDERS — the revised business process (pilot learning: procurement room
--    stays locked; zone admins pre-order from their own device, procurement
--    packs, requester collects). Stock is decremented by procurement at
--    packing time, attributed to the requester — no self-logging anywhere.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  order_no     bigint generated always as identity,
  requested_by uuid not null references public.users(id),
  location_id  uuid not null references public.locations(id), -- pickup room
  zone         text,
  status       text not null default 'pending'
               check (status in ('pending','ready','collected','rejected','cancelled')),
  note         text,        -- requester's note
  admin_note   text,        -- procurement's note
  packed_by    uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  ready_at     timestamptz,
  collected_at timestamptz
);

create index orders_status_idx on public.orders (status);
create index orders_requester_idx on public.orders (requested_by, created_at desc);

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_lines (
  order_id      uuid not null references public.orders(id) on delete cascade,
  item_id       uuid not null references public.items(id),
  qty_requested int not null check (qty_requested > 0),
  qty_packed    int check (qty_packed is null or qty_packed >= 0),
  primary key (order_id, item_id)
);

alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

-- Requester + admins can read; ALL writes go through the RPCs below.
create policy orders_read on public.orders for select to authenticated
  using (requested_by = auth.uid() or public.is_admin());
create policy order_lines_read on public.order_lines for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.requested_by = auth.uid() or public.is_admin())
  ));

-- Staff places an order from their own device.
-- p_lines: [{"item_id":"...","qty":3}, ...]
create function public.create_order(
  p_location_id uuid, p_zone text, p_lines jsonb, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_role text := public.current_user_role();
  v_order_id uuid;
  v_order_no bigint;
  v_line record;
  v_total int := 0;
  v_count int := 0;
begin
  if v_role not in ('staff','procurement','super_admin') then
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

  for v_line in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by 1
  loop
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;
    if not exists (select 1 from public.items where id = v_line.item_id and is_active) then
      raise exception 'Item not found.';
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

-- Requester cancels their own order while it is still pending.
create function public.cancel_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.orders
  set status = 'cancelled'
  where id = p_order_id and requested_by = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Only your own pending orders can be cancelled.';
  end if;
end;
$$;

-- Procurement packs an order: records the checkout transactions (attributed
-- to the requester, on_behalf_of the packer, stamped with the order zone)
-- and marks it ready for collection.
-- p_lines: [{"item_id":"...","qty":2}, ...] — packed quantities; a line may
-- be reduced (or 0 = not packed) when stock ran short.
create function public.pack_order(
  p_order_id uuid, p_location_id uuid, p_lines jsonb, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_actor uuid := public._require_admin();
  v_order public.orders;
  v_line record;
  v_qty int;
  v_total int := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Order not found.';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Order #% was already handled (%).', v_order.order_no, v_order.status;
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Pick a valid store room.';
  end if;

  for v_line in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
    group by 1
    order by 1
  loop
    v_qty := coalesce(v_line.qty, 0);
    if v_qty < 0 then
      raise exception 'Packed quantity cannot be negative.';
    end if;
    update public.order_lines
    set qty_packed = v_qty
    where order_id = p_order_id and item_id = v_line.item_id;
    if not found then
      raise exception 'That item is not on this order.';
    end if;
    if v_qty > 0 then
      perform public._apply_transaction(
        'checkout', v_line.item_id, p_location_id, -v_qty, v_order.requested_by,
        'Order #' || v_order.order_no, v_actor, null, v_order.zone);
      v_total := v_total + v_qty;
    end if;
  end loop;

  -- Any order line not mentioned in p_lines counts as not packed.
  update public.order_lines set qty_packed = 0
  where order_id = p_order_id and qty_packed is null;

  if v_total = 0 then
    raise exception 'Nothing was packed — reduce quantities or reject the order instead.';
  end if;

  update public.orders
  set status = 'ready', packed_by = v_actor, ready_at = now(),
      location_id = p_location_id,
      admin_note = nullif(trim(coalesce(p_note,'')), '')
  where id = p_order_id;

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'total_units', v_total,
    'requester_id', v_order.requested_by,
    'requester_name', (select full_name from public.users where id = v_order.requested_by),
    'requester_phone', (select phone from public.users where id = v_order.requested_by),
    'location_name', (select name from public.locations where id = p_location_id)
  );
end;
$$;

-- Hand-over: ready → collected.
create function public.collect_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  update public.orders
  set status = 'collected', collected_at = now()
  where id = p_order_id and status = 'ready';
  if not found then
    raise exception 'Only ready orders can be marked collected.';
  end if;
end;
$$;

-- Decline a pending order (nothing was packed, no stock moves).
create function public.reject_order(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_order public.orders;
begin
  perform public._require_admin();
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.status <> 'pending' then
    raise exception 'Only pending orders can be rejected.';
  end if;
  update public.orders
  set status = 'rejected', admin_note = nullif(trim(coalesce(p_note,'')), '')
  where id = p_order_id;
  return jsonb_build_object(
    'order_no', v_order.order_no,
    'requester_phone', (select phone from public.users where id = v_order.requested_by),
    'admin_note', nullif(trim(coalesce(p_note,'')), '')
  );
end;
$$;

-- Dashboard: orders to pack / awaiting collection.
create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'low_stock', (select count(*) from public.stock_levels sl
                  join public.items i on i.id = sl.item_id and i.is_active
                  where sl.reorder_point > 0 and sl.qty_on_hand <= sl.reorder_point),
    'out_of_stock', (select count(*) from public.stock_levels sl
                     join public.items i on i.id = sl.item_id and i.is_active
                     where sl.reorder_point > 0 and sl.qty_on_hand = 0),
    'open_requests', (select count(*) from public.requests where status in ('open','acknowledged')),
    'ordered_requests', (select count(*) from public.requests where status = 'ordered'),
    'pending_orders', (select count(*) from public.orders where status = 'pending'),
    'ready_orders', (select count(*) from public.orders where status = 'ready'),
    'pending_approvals', (select count(*) from public.pending_checkouts where status = 'pending'),
    'checkouts_today', (select coalesce(sum(-qty_delta), 0) from public.transactions
                        where type = 'checkout'
                          and created_at >= date_trunc('day', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore'),
    'top_movers_week', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select i.name, sum(-t.qty_delta) as qty
      from public.transactions t
      join public.items i on i.id = t.item_id
      where t.type = 'checkout' and t.created_at > now() - interval '7 days'
      group by i.name
      order by qty desc
      limit 5
    ) x)
  ) into v_result;
  return v_result;
end;
$$;
