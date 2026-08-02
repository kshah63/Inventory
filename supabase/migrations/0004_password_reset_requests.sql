-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0004 — In-app password reset requests
--
-- "Forgot your password?" on the login page files a request that appears on
-- the admin dashboard; procurement generates a new temporary password with
-- one click. No email involved. Run once, after 0003.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.password_reset_requests (
  id           uuid primary key default gen_random_uuid(),
  identifier   text not null,                      -- what the person typed (email or User ID)
  matched_user uuid references public.users(id),   -- resolved server-side; null = no match
  status       text not null default 'open'
               check (status in ('open','done','dismissed')),
  created_at   timestamptz not null default now(),
  handled_by   uuid references public.users(id),
  handled_at   timestamptz
);

create index if not exists prr_status_idx
  on public.password_reset_requests (status, created_at);

alter table public.password_reset_requests enable row level security;

-- Procurement + super admins read and update; creation goes through the
-- SECURITY DEFINER function below (no anon table access at all).
drop policy if exists prr_admin_read on public.password_reset_requests;
create policy prr_admin_read on public.password_reset_requests
  for select to authenticated using (public.is_admin());
drop policy if exists prr_admin_update on public.password_reset_requests;
create policy prr_admin_update on public.password_reset_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Public entry point for the login page. Deliberately NEVER errors and never
-- reveals whether an account exists; throttled per identifier.
create or replace function public.submit_password_reset(p_identifier text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_id text := lower(trim(coalesce(p_identifier, '')));
  v_matched uuid;
begin
  if v_id = '' or length(v_id) > 200 then
    return;
  end if;

  -- Throttle: at most 3 requests per identifier per hour, 100 open overall.
  if (select count(*) from public.password_reset_requests
      where identifier = v_id and created_at > now() - interval '1 hour') >= 3 then
    return;
  end if;
  if (select count(*) from public.password_reset_requests where status = 'open') >= 100 then
    return;
  end if;

  if v_id ~ '^[0-9]{4}$' then
    select id into v_matched
    from public.users
    where user_no = v_id::int and is_active and role <> 'kiosk';
  else
    select u.id into v_matched
    from auth.users au
    join public.users u on u.id = au.id
    where lower(au.email) = v_id and u.is_active;
  end if;

  insert into public.password_reset_requests (identifier, matched_user)
  values (v_id, v_matched);
end;
$$;

grant execute on function public.submit_password_reset(text) to anon, authenticated;

-- Dashboard: count of open reset requests.
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
    'reset_requests', (select count(*) from public.password_reset_requests where status = 'open'),
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
