-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0010 — Requesters see when their order has moved on
--
--  Procurement packs an order and marks it ready; nothing on the requester's
--  screen said so until they thought to look. Orders now remember when their
--  status last changed, who changed it, and when the requester last opened
--  My orders — enough to show an unread marker on the tab.
-- Run once, after 0009. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists status_changed_at timestamptz;
alter table public.orders add column if not exists status_changed_by uuid
  references public.users(id);
alter table public.orders add column if not exists seen_at timestamptz;

-- Existing orders start read: nobody wants a badge for last week's history.
update public.orders
set status_changed_at = coalesce(status_changed_at, updated_at, created_at),
    seen_at = coalesce(seen_at, now())
where status_changed_at is null or seen_at is null;

-- Stamp every status change, whoever makes it. The RPCs all go through
-- update, so this catches pack, collect, reject and cancel alike.
create or replace function public.stamp_order_status_change()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_stamp on public.orders;
create trigger orders_status_stamp before update on public.orders
  for each row execute function public.stamp_order_status_change();

-- How many of my orders have moved since I last looked. A change I made
-- myself — cancelling — doesn't count as news.
create or replace function public.unread_order_count()
returns int
language sql stable security definer set search_path = public, extensions
as $$
  select count(*)::int
  from public.orders o
  where o.requested_by = auth.uid()
    and o.status_changed_at is not null
    and o.status_changed_at > coalesce(o.seen_at, o.created_at)
    and o.status_changed_by is distinct from o.requested_by
$$;

grant execute on function public.unread_order_count() to authenticated;

-- Called when the requester opens My orders.
create or replace function public.mark_orders_seen()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.orders
  set seen_at = now()
  where requested_by = auth.uid()
    and (seen_at is null or seen_at < coalesce(status_changed_at, created_at));
end;
$$;

grant execute on function public.mark_orders_seen() to authenticated;
