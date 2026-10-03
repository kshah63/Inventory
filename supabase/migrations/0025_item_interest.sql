-- 0025_item_interest.sql
-- A soft demand signal for catalogue items that are out of stock. Pressing
-- "Express interest" just tallies that someone would want the item — it is
-- NOT a request and creates no task for procurement to clear; they can glance
-- at the tally when deciding what to restock. One signal per person per item,
-- toggleable. Separate from the formal "new item" request queue.
--
-- Safe on a live database; re-runnable.

create table if not exists public.item_interest (
  item_id    uuid not null references public.items(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists item_interest_item_idx on public.item_interest (item_id);

alter table public.item_interest enable row level security;

-- You see your own interest; procurement sees everyone's, which is the tally.
drop policy if exists item_interest_read on public.item_interest;
create policy item_interest_read on public.item_interest for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Managing your own only, and only on an item you can actually see.
drop policy if exists item_interest_insert on public.item_interest;
create policy item_interest_insert on public.item_interest for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.items i
      where i.id = item_id and i.is_active and (not i.admin_only or public.is_admin())
    )
  );

drop policy if exists item_interest_delete on public.item_interest;
create policy item_interest_delete on public.item_interest for delete to authenticated
  using (user_id = auth.uid());

-- ── Express / withdraw ─────────────────────────────────────────────────────
create or replace function public.express_interest(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.items i
    where i.id = p_item_id and i.is_active and (not i.admin_only or public.is_admin())
  ) then
    raise exception 'Item not found.';
  end if;
  insert into public.item_interest (item_id, user_id)
  values (p_item_id, auth.uid())
  on conflict (item_id, user_id) do nothing;
end;
$$;
grant execute on function public.express_interest(uuid) to authenticated;

create or replace function public.withdraw_interest(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.item_interest where item_id = p_item_id and user_id = auth.uid();
end;
$$;
grant execute on function public.withdraw_interest(uuid) to authenticated;
