-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0015 — Central-team items, real store rooms, and deleting
--
--   • items.admin_only — heavy cleaning supplies and the like. Nobody
--     outside the central team orders these, so nobody outside it sees them.
--     Enforced in the read policy, not just hidden in the app: the items
--     table is readable by every signed-in account, so a UI filter alone
--     would leave them a query away.
--   • Store rooms per item. Everything was carrying a stock row for both
--     rooms, so the Basement listed 100-odd items at zero that aren't there.
--     A room now means "we keep it here".
--   • delete_item() — a real delete for mistakes, refused once an item has
--     history, because the ledger points at it.
-- Run once, after 0014. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Central-team-only items.
alter table public.items add column if not exists admin_only boolean not null default false;

drop policy if exists items_read on public.items;
create policy items_read on public.items for select to authenticated
  using (not admin_only or public.is_admin());

-- Stock levels follow the item: no point hiding the item and leaving its
-- quantities readable.
drop policy if exists stock_read on public.stock_levels;
create policy stock_read on public.stock_levels for select to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and (not i.admin_only or public.is_admin())
    )
  );

-- 2. Where an item is actually kept. Admins say; a room with no row means
--    we don't keep it there, so it stops cluttering that room's list.
create or replace function public.set_item_rooms(p_item_id uuid, p_location_ids uuid[])
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_removed record;
begin
  perform public._require_admin();
  if not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'Item not found.';
  end if;

  -- Never drop a room that still holds stock — that would lose the count
  -- silently. Move it out first.
  for v_removed in
    select l.name, sl.qty_on_hand
    from public.stock_levels sl
    join public.locations l on l.id = sl.location_id
    where sl.item_id = p_item_id
      and sl.qty_on_hand > 0
      and not (sl.location_id = any(coalesce(p_location_ids, '{}')))
  loop
    raise exception
      'There are still % in %. Transfer or adjust them to zero first.',
      v_removed.qty_on_hand, v_removed.name;
  end loop;

  delete from public.stock_levels
  where item_id = p_item_id
    and not (location_id = any(coalesce(p_location_ids, '{}')));

  insert into public.stock_levels (item_id, location_id, qty_on_hand)
  select p_item_id, l, 0
  from unnest(coalesce(p_location_ids, '{}')) l
  on conflict (item_id, location_id) do nothing;
end;
$$;

grant execute on function public.set_item_rooms(uuid, uuid[]) to authenticated;

-- 3. Delete an item outright — only while it has no history to lose.
create or replace function public.delete_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_name text;
begin
  perform public._require_admin();

  select name into v_name from public.items where id = p_item_id;
  if v_name is null then
    raise exception 'Item not found.';
  end if;

  if exists (select 1 from public.transactions where item_id = p_item_id) then
    raise exception
      '"%" has stock history, so deleting it would tear a hole in the ledger. Remove it from the catalogue instead.',
      v_name;
  end if;
  if exists (select 1 from public.order_lines where item_id = p_item_id) then
    raise exception '"%" appears on an order. Remove it from the catalogue instead.', v_name;
  end if;
  if exists (select 1 from public.requests
             where item_id = p_item_id or fulfilled_item_id = p_item_id) then
    raise exception '"%" appears on a request. Remove it from the catalogue instead.', v_name;
  end if;
  if exists (select 1 from public.stocktake_lines where item_id = p_item_id) then
    raise exception '"%" appears on a stocktake. Remove it from the catalogue instead.', v_name;
  end if;

  delete from public.stock_levels where item_id = p_item_id;
  delete from public.item_aliases where item_id = p_item_id;
  delete from public.pending_checkouts where item_id = p_item_id;
  delete from public.items where id = p_item_id;
end;
$$;

grant execute on function public.delete_item(uuid) to authenticated;

-- 4. The read policy covers anything the app queries as the signed-in
--    person, but not the SECURITY DEFINER functions — those run as the
--    owner and see everything. Two of them face the whole school, so they
--    have to do the filtering themselves.

-- 4a. Suggestions on the request form. A restricted item must not appear,
--     or the name leaks even though the row can't be read.
create or replace function public.search_catalogue(p_query text, p_limit int default 3)
returns table (
  item_id uuid, sku text, name text, unit text, qty_on_hand bigint,
  max_per_order int, matched_alias text, score real
)
language sql stable security definer set search_path = public, extensions
as $$
  with q as (
    select
      lower(trim(coalesce(p_query, ''))) as phrase,
      array_remove(
        regexp_split_to_array(lower(trim(coalesce(p_query, ''))), '[^a-z0-9]+'),
        ''
      ) as tokens
  ),
  haystack as (
    select
      i.id, i.sku, i.name, i.unit, i.max_per_checkout,
      lower(
        i.name || ' ' || i.sku || ' ' ||
        coalesce((select string_agg(a.alias, ' ')
                  from public.item_aliases a where a.item_id = i.id), '')
      ) as text
    from public.items i
    where i.is_active
      -- Central-team items are invisible here too.
      and (not i.admin_only or public.is_admin())
  ),
  scored as (
    select
      h.id, h.sku, h.name, h.unit, h.max_per_checkout,
      greatest(
        case when lower(h.sku) = q.phrase then 1.0 else 0 end,
        case when q.phrase <> '' and position(q.phrase in h.text) > 0
             then 0.9 else 0 end,
        case
          when cardinality(q.tokens) > 0 and (
            select bool_and(
              position(t in h.text) > 0
              or (length(t) >= 4 and right(t, 1) = 's'
                  and position(left(t, length(t) - 1) in h.text) > 0)
            )
            from unnest(q.tokens) t
          ) then 0.85 else 0
        end,
        similarity(lower(h.name), q.phrase)
      )::real as score,
      (
        select a.alias from public.item_aliases a
        where a.item_id = h.id
          and (position(q.phrase in lower(a.alias)) > 0
               or similarity(lower(a.alias), q.phrase) > 0.3)
        order by similarity(lower(a.alias), q.phrase) desc
        limit 1
      ) as matched_alias
    from haystack h, q
    where length(q.phrase) >= 2
  )
  select
    s.id, s.sku, s.name, s.unit,
    coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
              where sl.item_id = s.id), 0),
    s.max_per_checkout,
    s.matched_alias,
    s.score
  from scored s
  where s.score >= 0.3
  order by s.score desc, length(s.name), s.name
  limit greatest(1, least(coalesce(p_limit, 3), 10))
$$;

grant execute on function public.search_catalogue(text, int) to authenticated;

-- 4b. Ordering. The item id is all a hand-written request needs, so the
--     lookup itself has to refuse — same wording as a genuinely missing
--     item, since "you may not see this" is itself a disclosure.
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

-- And the same on the edit path, which rebuilds the lines from scratch.
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
  if v_order.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Order #% is already being packed — cancel it instead.', v_order.order_no;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one item. Cancel it instead.';
  end if;

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

  update public.orders set updated_at = now() where id = p_order_id;

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'total_units', v_total,
    'line_count', v_count
  );
end;
$$;

-- 5. Tidy the rooms as they stand: an item with nothing in a room, and no
--    history there, isn't kept there.
delete from public.stock_levels sl
where sl.qty_on_hand = 0
  and sl.reorder_point = 0
  and sl.par_level = 0
  and not exists (
    select 1 from public.transactions t
    where t.item_id = sl.item_id and t.location_id = sl.location_id
  );
