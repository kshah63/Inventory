-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0019 — One number per item instead of four
--
--  Stock levels carried a reorder point and a par level, per item *per room*.
--  For a hundred-odd items across two rooms that is several hundred numbers
--  to keep straight, and nobody was ever going to. Worse, a reorder point of
--  zero — the default — made an item invisible to the whole reorder system,
--  so the commonest state was also the silently broken one.
--
--  items.keep_about replaces all four with one: roughly how many we like to
--  have. It shows on Reorder once we're down to about half of it, and the
--  suggested quantity is simply the difference. Null means nobody is
--  tracking it, which is now an honest answer rather than an accident.
--
--  Per item, not per room: after 0015 nearly everything lives on Level 8
--  alone, so per-room targets were tuning a case that barely exists. Counts
--  are totalled across rooms, because we buy for the school, not the shelf.
--
--  reorder_point and par_level stay on stock_levels, holding the numbers
--  this backfills from. Nothing reads them any more.
-- Run once, after 0018. Safe on a live database. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.items add column if not exists keep_about int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'items_keep_about_check'
  ) then
    alter table public.items
      add constraint items_keep_about_check check (keep_about is null or keep_about > 0);
  end if;
end $$;

-- Carry over what's already been set: the par levels are the target, so they
-- add up across rooms. Where only a reorder point was set, that's the best
-- guess we have. Items with neither stay null — untracked, as they were.
update public.items i
set keep_about = coalesce(nullif(t.par_total, 0), nullif(t.reorder_total, 0))
from (
  select item_id,
         sum(par_level)::int as par_total,
         sum(reorder_point)::int as reorder_total
  from public.stock_levels
  group by item_id
) t
where t.item_id = i.id
  and i.keep_about is null
  and coalesce(nullif(t.par_total, 0), nullif(t.reorder_total, 0)) is not null;

-- ── What to buy ────────────────────────────────────────────────────────────
-- One row per item, counted across every room it's kept in.
drop function if exists public.get_reorder_dashboard();
create or replace function public.get_reorder_dashboard()
returns table (
  item_id uuid, sku text, item_name text, category_name text, unit text,
  qty_on_hand int, keep_about int, suggested_qty int,
  avg_daily_use numeric, days_to_stockout numeric
)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  return query
  with on_hand as (
    select sl.item_id, sum(sl.qty_on_hand)::int as qty
    from public.stock_levels sl
    join public.locations l on l.id = sl.location_id and l.is_active
    group by sl.item_id
  ),
  usage as (
    select t.item_id, sum(-t.qty_delta)::numeric / 30 as daily
    from public.transactions t
    where t.type = 'checkout' and t.created_at > now() - interval '30 days'
    group by t.item_id
  )
  select
    i.id, i.sku, i.name, c.name, i.unit,
    coalesce(o.qty, 0), i.keep_about,
    greatest(i.keep_about - coalesce(o.qty, 0), 0),
    round(coalesce(u.daily, 0), 2),
    case when coalesce(u.daily, 0) > 0
         then round(coalesce(o.qty, 0) / u.daily, 1)
         else null end
  from public.items i
  join public.categories c on c.id = i.category_id
  left join on_hand o on o.item_id = i.id
  left join usage u on u.item_id = i.id
  where i.is_active
    and i.keep_about is not null
    -- Down to about half of what we like to have. Not at the first one
    -- missing, which would put the whole catalogue on the list.
    and coalesce(o.qty, 0) * 2 <= i.keep_about
  order by (coalesce(o.qty, 0) = 0) desc, i.name;
end;
$$;

-- ── The dashboard's two stock cards ────────────────────────────────────────
-- Both now count items, matching what the Inventory grid's filters show —
-- they disagreed before, because the cards only counted rows with a reorder
-- point set and the grid counted anything at zero.
create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'low_stock', (
      select count(*) from public.items i
      where i.is_active and i.keep_about is not null
        and coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
                      where sl.item_id = i.id), 0) * 2 <= i.keep_about
    ),
    -- No reorder target needed: having none of something is true either way.
    'out_of_stock', (
      select count(*) from public.items i
      where i.is_active
        and coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
                      where sl.item_id = i.id), 0) = 0
    ),
    'open_requests', (select count(*) from public.requests
                      where status in ('open','acknowledged')),
    'ordered_requests', (select count(*) from public.requests
                         where status in ('ordered','received')),
    'requests_to_hand_over', (select count(*) from public.requests
                              where status = 'ready'),
    'pending_orders', (select count(*) from public.orders where status = 'pending'),
    'ready_orders', (select count(*) from public.orders where status = 'ready'),
    'reset_requests', (select count(*) from public.password_reset_requests
                       where status = 'open'),
    'checkouts_today', (select coalesce(sum(-qty_delta), 0) from public.transactions
                        where type = 'checkout' and created_at >= date_trunc('day', now())),
    'top_movers_week', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select i.name, sum(-t.qty_delta)::int as qty
      from public.transactions t
      join public.items i on i.id = t.item_id
      where t.type = 'checkout' and t.created_at > now() - interval '7 days'
      group by i.name
      order by 2 desc
      limit 5
    ) x)
  ) into v_result;
  return v_result;
end;
$$;

-- ── Import ─────────────────────────────────────────────────────────────────
-- keep_about is an item-level column now, so the CSV carries one column
-- instead of two per room. The old per-room columns are still accepted and
-- still written, so an older file imports without complaint.
create or replace function public.import_catalog(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_row jsonb;
  v_stock jsonb;
  v_category_id uuid;
  v_item_id uuid;
  v_location_id uuid;
  v_qty int;
  v_on_hand int;
  v_created int := 0;
  v_updated int := 0;
  v_adjusted int := 0;
begin
  perform public._require_admin();
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows to import.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if nullif(trim(coalesce(v_row->>'sku','')), '') is null
       or nullif(trim(coalesce(v_row->>'name','')), '') is null
       or nullif(trim(coalesce(v_row->>'category','')), '') is null then
      raise exception 'Each row needs sku, name and category (row: %).',
        coalesce(v_row->>'sku', v_row->>'name', '?');
    end if;

    select id into v_category_id from public.categories
    where lower(name) = lower(trim(v_row->>'category'));
    if v_category_id is null then
      insert into public.categories (name, sort_order)
      values (trim(v_row->>'category'),
              coalesce((select max(sort_order) from public.categories), 0) + 1)
      returning id into v_category_id;
    end if;

    select id into v_item_id from public.items where sku = trim(v_row->>'sku');
    if v_item_id is null then
      insert into public.items (sku, name, category_id, unit, pack_size, notes,
                                max_per_checkout, keep_about)
      values (
        trim(v_row->>'sku'),
        trim(v_row->>'name'),
        v_category_id,
        coalesce(nullif(trim(coalesce(v_row->>'unit','')),''), 'pcs'),
        nullif(v_row->>'pack_size','')::int,
        nullif(trim(coalesce(v_row->>'notes','')), ''),
        nullif(v_row->>'max_per_checkout','')::int,
        nullif(v_row->>'keep_about','')::int
      )
      returning id into v_item_id;
      v_created := v_created + 1;
    else
      update public.items
      set name = trim(v_row->>'name'),
          category_id = v_category_id,
          unit = coalesce(nullif(trim(coalesce(v_row->>'unit','')),''), unit),
          pack_size = coalesce(nullif(v_row->>'pack_size','')::int, pack_size),
          notes = coalesce(nullif(trim(coalesce(v_row->>'notes','')), ''), notes),
          max_per_checkout = coalesce(nullif(v_row->>'max_per_checkout','')::int,
                                      max_per_checkout),
          keep_about = coalesce(nullif(v_row->>'keep_about','')::int, keep_about),
          is_active = true
      where id = v_item_id;
      v_updated := v_updated + 1;
    end if;

    for v_stock in select * from jsonb_array_elements(coalesce(v_row->'stock', '[]'::jsonb)) loop
      select id into v_location_id from public.locations
      where lower(name) = lower(trim(v_stock->>'location'));
      if v_location_id is null then
        raise exception 'Unknown location "%" (row %).', v_stock->>'location', v_row->>'sku';
      end if;

      insert into public.stock_levels (item_id, location_id, reorder_point, par_level)
      values (
        v_item_id, v_location_id,
        coalesce(nullif(v_stock->>'reorder_point','')::int, 0),
        coalesce(nullif(v_stock->>'par_level','')::int, 0)
      )
      on conflict (item_id, location_id) do update
      set reorder_point = coalesce(nullif(v_stock->>'reorder_point','')::int,
                                   public.stock_levels.reorder_point),
          par_level = coalesce(nullif(v_stock->>'par_level','')::int,
                               public.stock_levels.par_level);

      -- A blank qty means "don't touch the count" — that's what makes
      -- re-importing the same file a no-op.
      v_qty := nullif(v_stock->>'qty','')::int;
      if v_qty is not null then
        select qty_on_hand into v_on_hand from public.stock_levels
        where item_id = v_item_id and location_id = v_location_id;
        if coalesce(v_on_hand, 0) <> v_qty then
          perform public._apply_transaction(
            'adjustment', v_item_id, v_location_id, v_qty - coalesce(v_on_hand, 0),
            auth.uid(), 'CSV import');
          v_adjusted := v_adjusted + 1;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'stock_adjusted', v_adjusted);
end;
$$;

-- The per-room editor it served is gone.
drop function if exists public.set_stock_params(uuid, uuid, int, int);
