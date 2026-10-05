-- 0029_restock_notices.sql
-- When an item people expressed interest in comes back into stock:
--   • each interested person gets a "back in stock" notice (shown in-app on
--     the catalogue — this app has no SMS/email channel), and
--   • the interest tally is cleared, so procurement's "N interested" badge
--     doesn't linger as though people still can't get the item.
--
-- Interest is only ever expressed on a truly out-of-stock item, so the signal
-- to act on is the item crossing from zero stock (across every room) back to
-- positive. A stock change goes through one place — _apply_transaction's
-- update of stock_levels — so one AFTER UPDATE trigger there catches every
-- restock (receive, adjustment, transfer in, return, stocktake).
--
-- Safe on a live database; re-runnable.

-- ── Per-person "back in stock" notices ─────────────────────────────────────
create table if not exists public.restock_notices (
  user_id    uuid not null references public.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Null until the person has seen (dismissed) it.
  seen_at    timestamptz,
  primary key (user_id, item_id)
);
create index if not exists restock_notices_unseen_idx
  on public.restock_notices (user_id) where seen_at is null;

alter table public.restock_notices enable row level security;

-- You see your own notices; procurement can see them too. Writes happen only
-- through the restock trigger and the mark-seen RPC (both security definer),
-- so there's no insert/update/delete policy for ordinary callers.
drop policy if exists restock_notices_read on public.restock_notices;
create policy restock_notices_read on public.restock_notices for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ── The trigger: zero → positive, with interest, notifies and clears ───────
create or replace function public.notify_restock()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_after  int;
  v_before int;
begin
  -- Only an increase can be a restock; checkouts and the like are ignored.
  if new.qty_on_hand <= old.qty_on_hand then
    return new;
  end if;

  select coalesce(sum(qty_on_hand), 0) into v_after
  from public.stock_levels where item_id = new.item_id;
  -- What the item's total was before this one row changed.
  v_before := v_after - new.qty_on_hand + old.qty_on_hand;

  if v_before <= 0 and v_after > 0
     and exists (select 1 from public.item_interest where item_id = new.item_id) then
    -- Tell everyone who was waiting, re-arming a notice they'd already seen.
    insert into public.restock_notices (user_id, item_id)
      select user_id, new.item_id from public.item_interest where item_id = new.item_id
      on conflict (user_id, item_id)
        do update set created_at = now(), seen_at = null;
    -- Clear the tally so it no longer reads as unmet demand.
    delete from public.item_interest where item_id = new.item_id;
  end if;

  return new;
end;
$$;

drop trigger if exists stock_levels_restock on public.stock_levels;
create trigger stock_levels_restock
  after update of qty_on_hand on public.stock_levels
  for each row execute function public.notify_restock();

-- ── Dismissing the notices ─────────────────────────────────────────────────
create or replace function public.mark_restock_notices_seen()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.restock_notices
  set seen_at = now()
  where user_id = auth.uid() and seen_at is null;
end;
$$;

grant execute on function public.mark_restock_notices_seen() to authenticated;
