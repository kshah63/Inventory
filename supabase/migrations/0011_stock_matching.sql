-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0011 — Catch "we already stock that" before it becomes a request
--
--  People raise requests for things sitting on the shelf, because they don't
--  know what's there and the catalogue names are our own wording. Two halves:
--
--   • search_catalogue() — typo-tolerant search over names, codes and a list
--     of aliases procurement can grow. Shown live as someone types a request.
--   • fulfil_request_from_stock() — one action that turns a request into a
--     real order for the requester and closes the request, so procurement's
--     knowledge resolves it instead of ending up in a note.
--
--  Every request is still accepted. Nothing here refuses one.
-- Run once, after 0010. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm with schema extensions;

-- 1. The words people actually use. "punch pocket" → A4 SHEET PROTECTOR.
create table if not exists public.item_aliases (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete cascade,
  alias      text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists item_aliases_unique
  on public.item_aliases (item_id, lower(alias));
create index if not exists item_aliases_trgm
  on public.item_aliases using gin (alias extensions.gin_trgm_ops);
create index if not exists items_name_trgm
  on public.items using gin (name extensions.gin_trgm_ops);

alter table public.item_aliases enable row level security;

drop policy if exists item_aliases_read on public.item_aliases;
create policy item_aliases_read on public.item_aliases
  for select to authenticated using (true);

drop policy if exists item_aliases_admin_write on public.item_aliases;
create policy item_aliases_admin_write on public.item_aliases
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2. What did they mean? Ranked, and deliberately mean about it: three good
--    matches help, ten weak ones train people to ignore the suggestion.
create or replace function public.search_catalogue(p_query text, p_limit int default 3)
returns table (
  item_id uuid, sku text, name text, unit text, qty_on_hand bigint,
  max_per_order int, matched_alias text, score real
)
language sql stable security definer set search_path = public, extensions
as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as text
  ),
  scored as (
    select
      i.id,
      i.sku,
      i.name,
      i.unit,
      i.max_per_checkout,
      -- Best of: the name contains what they typed, the code matches, or an
      -- alias does — each scored so exact contains beats a fuzzy match.
      greatest(
        case when position(q.text in lower(i.name)) > 0 then 0.9 else 0 end,
        case when lower(i.sku) = q.text then 1.0 else 0 end,
        similarity(lower(i.name), q.text),
        coalesce((
          select greatest(
            max(case when position(q.text in lower(a.alias)) > 0 then 0.95 else 0 end),
            max(similarity(lower(a.alias), q.text)))
          from public.item_aliases a where a.item_id = i.id
        ), 0)
      )::real as score,
      (
        select a.alias from public.item_aliases a
        where a.item_id = i.id
          and (position(q.text in lower(a.alias)) > 0 or similarity(lower(a.alias), q.text) > 0.3)
        order by similarity(lower(a.alias), q.text) desc
        limit 1
      ) as matched_alias
    from public.items i, q
    where i.is_active and length(q.text) >= 2
  )
  select
    s.id, s.sku, s.name, s.unit,
    coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl where sl.item_id = s.id), 0),
    s.max_per_checkout,
    s.matched_alias,
    s.score
  from scored s
  where s.score >= 0.3
  order by s.score desc, s.name
  limit greatest(1, least(coalesce(p_limit, 3), 10))
$$;

grant execute on function public.search_catalogue(text, int) to authenticated;

-- 3. Procurement resolves a request from stock: it becomes a real order for
--    the person who asked, and the request closes.
alter table public.requests add column if not exists fulfilled_item_id uuid
  references public.items(id);

create or replace function public.fulfil_request_from_stock(
  p_request_id uuid, p_item_id uuid, p_qty int, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_request public.requests;
  v_item public.items;
  v_location uuid;
  v_order_id uuid;
  v_order_no bigint;
begin
  perform public._require_admin();

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status in ('fulfilled','rejected') then
    raise exception 'That request has already been closed.';
  end if;

  select * into v_item from public.items where id = p_item_id and is_active;
  if v_item.id is null then
    raise exception 'Item not found.';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be at least 1.';
  end if;

  -- Pack from wherever most of it sits; procurement can change that when
  -- they actually pack the order.
  select sl.location_id into v_location
  from public.stock_levels sl
  join public.locations l on l.id = sl.location_id and l.is_active
  where sl.item_id = p_item_id
  order by sl.qty_on_hand desc
  limit 1;
  if v_location is null then
    select id into v_location from public.locations where is_active order by name limit 1;
  end if;
  if v_location is null then
    raise exception 'No active store room.';
  end if;

  insert into public.orders (requested_by, location_id, zone, note, status_changed_at,
                             status_changed_by)
  values (v_request.requested_by, v_location, v_request.zone,
          'Raised as a request — we had it in stock.', now(), auth.uid())
  returning id, order_no into v_order_id, v_order_no;

  insert into public.order_lines (order_id, item_id, qty_requested)
  values (v_order_id, p_item_id, p_qty);

  update public.requests
  set status = 'fulfilled',
      fulfilled_item_id = p_item_id,
      admin_note = coalesce(nullif(trim(coalesce(p_note, '')), ''),
                            'We stock this — ordered for you as #' || v_order_no || '.')
  where id = p_request_id;

  return jsonb_build_object(
    'order_no', v_order_no,
    'item_name', v_item.name,
    'qty', p_qty,
    'requester_id', v_request.requested_by,
    'requester_phone', (select phone from public.users where id = v_request.requested_by),
    'requested_text', coalesce(v_request.free_text_item, '')
  );
end;
$$;

grant execute on function public.fulfil_request_from_stock(uuid, uuid, int, text) to authenticated;

-- 4. Remember the words that person used, so the next one gets a suggestion.
create or replace function public.add_item_alias(p_item_id uuid, p_alias text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_alias text := nullif(trim(coalesce(p_alias, '')), '');
begin
  perform public._require_admin();
  if v_alias is null or length(v_alias) > 120 then
    return;
  end if;
  if not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'Item not found.';
  end if;
  insert into public.item_aliases (item_id, alias, created_by)
  values (p_item_id, v_alias, auth.uid())
  on conflict (item_id, lower(alias)) do nothing;
end;
$$;

grant execute on function public.add_item_alias(uuid, text) to authenticated;

-- 5. How often are requests really new? Feeds the admin view.
create or replace function public.request_origin_stats(p_days int default 90)
returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'from_stock', count(*) filter (where fulfilled_item_id is not null),
    'genuinely_new', count(*) filter (where fulfilled_item_id is null and status = 'fulfilled'),
    'open', count(*) filter (where status in ('open','acknowledged','ordered'))
  )
  from public.requests
  where created_at > now() - (greatest(1, coalesce(p_days, 90)) || ' days')::interval
$$;

grant execute on function public.request_origin_stats(int) to authenticated;
