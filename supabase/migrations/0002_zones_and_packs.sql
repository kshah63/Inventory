-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0002 — Zone-at-checkout, zone reporting, ordered-requests stat
--
-- Incorporates the pilot team's kiosk tool feedback: every checkout records
-- which Zone the supplies are for (replacing per-person departments), and
-- consumption reports can group by zone. Run after 0001 (safe on a live DB).
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
