-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0003 — Department Admin / Department Head roles, 4-digit User
-- IDs, department capture on requests
--
--  • Role picker in the app becomes: Department Admin (= 'staff') and
--    Department Head (= new 'dept_head': orders like an admin, plus
--    read-only oversight of reports & the audit ledger; no stock powers).
--    Procurement and Super Admin accounts are created from the back end only.
--  • users.department is replaced in the UI by a unique 4-digit User ID
--    (people move departments; the ID follows the person).
--  • The department question ("which department is this for?") is captured
--    at checkout AND on requests. Internally the columns/settings keep the
--    'zone' name from 0002; only labels changed.
-- Run once, after 0002. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. New role value
alter table public.users drop constraint users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('super_admin','procurement','staff','dept_head','kiosk'));

-- 2. 4-digit User IDs
alter table public.users add column if not exists user_no int unique
  check (user_no is null or (user_no between 1000 and 9999));

-- Backfill existing people (not kiosk devices), oldest first from 1001.
do $$
declare
  r record;
  v_no int := 1000;
begin
  select coalesce(max(user_no), 1000) into v_no from public.users;
  for r in
    select id from public.users
    where user_no is null and role <> 'kiosk'
    order by created_at
  loop
    v_no := v_no + 1;
    update public.users set user_no = v_no where id = r.id;
  end loop;
end $$;

create or replace function public._next_user_no()
returns int
language sql stable security definer set search_path = public, extensions
as $$
  select greatest(coalesce(max(user_no), 1000) + 1, 1001) from public.users
$$;
revoke execute on function public._next_user_no() from public, anon, authenticated;

-- Suggestion for the Users screen.
create or replace function public.get_next_user_no()
returns int
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  return public._next_user_no();
end;
$$;

-- 3. Reporting tier: dept_head reads the full ledger and reports.
create or replace function public.is_reporting()
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(public.current_user_role() in ('super_admin','procurement','dept_head'), false)
$$;

drop policy if exists transactions_read on public.transactions;
create policy transactions_read on public.transactions for select to authenticated
  using (user_id = auth.uid() or on_behalf_of = auth.uid() or public.is_reporting());

-- Reports open up to the reporting tier (stock mutations stay admin-only).
create or replace function public.report_consumption(
  p_from timestamptz, p_to timestamptz, p_group_by text
) returns table (group_key text, group_label text, total_qty bigint, tx_count bigint)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public.is_reporting() then
    raise exception 'Not authorized.';
  end if;
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
      when 'zone' then coalesce(t.zone, 'No department recorded')
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

create or replace function public.report_daily_usage(p_days int default 30)
returns table (day date, total_qty bigint)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public.is_reporting() then
    raise exception 'Not authorized.';
  end if;
  return query
  select
    (t.created_at at time zone 'Asia/Singapore')::date,
    sum(-t.qty_delta)::bigint
  from public.transactions t
  where t.type = 'checkout' and t.created_at > now() - make_interval(days => p_days)
  group by 1
  order by 1;
end;
$$;

-- 4. dept_head can order (same as staff) — widen the write paths.
drop policy if exists requests_insert_own on public.requests;
create policy requests_insert_own on public.requests for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'open'
    and public.current_user_role() in ('staff','dept_head','procurement','super_admin')
  );

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

-- 5. Department on requests (label; column keeps the internal 'zone' name).
alter table public.requests add column if not exists zone text;

-- 6. Profile plumbing: new-user trigger knows dept_head + assigns User IDs;
--    profile updates accept a User ID; staff creation assigns one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_app_meta_data->>'role', 'staff');
  if v_role not in ('super_admin','procurement','staff','dept_head','kiosk') then
    v_role := 'staff';
  end if;
  if v_role <> 'kiosk'
     and not exists (select 1 from public.users where role = 'super_admin') then
    v_role := 'super_admin';
  end if;
  insert into public.users (id, full_name, role, kiosk_location_id, user_no)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email, '@', 1)),
    v_role,
    nullif(new.raw_app_meta_data->>'kiosk_location_id','')::uuid,
    case when v_role = 'kiosk' then null
         else coalesce(nullif(new.raw_app_meta_data->>'user_no','')::int, public._next_user_no())
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop function if exists public.update_user_profile(uuid, text, text, text, text, boolean, uuid);
create or replace function public.update_user_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_department text default null,
  p_phone text default null,
  p_role text default null,
  p_is_active boolean default null,
  p_kiosk_location_id uuid default null,
  p_user_no int default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_user public.users;
  v_new_role text;
  v_new_active boolean;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  select * into v_user from public.users where id = p_user_id for update;
  if v_user.id is null then
    raise exception 'User not found.';
  end if;

  v_new_role := coalesce(p_role, v_user.role);
  v_new_active := coalesce(p_is_active, v_user.is_active);
  if v_new_role not in ('super_admin','procurement','staff','dept_head','kiosk') then
    raise exception 'Invalid role.';
  end if;
  if v_user.role = 'super_admin'
     and (v_new_role <> 'super_admin' or not v_new_active)
     and (select count(*) from public.users where role = 'super_admin' and is_active) <= 1 then
    raise exception 'Cannot remove the last active super admin.';
  end if;
  if p_user_no is not null
     and exists (select 1 from public.users where user_no = p_user_no and id <> p_user_id) then
    raise exception 'User ID % is already taken.', p_user_no;
  end if;

  update public.users
  set full_name = coalesce(nullif(trim(coalesce(p_full_name,'')),''), full_name),
      department = coalesce(p_department, department),
      phone = coalesce(p_phone, phone),
      role = v_new_role,
      is_active = v_new_active,
      kiosk_location_id = coalesce(p_kiosk_location_id, kiosk_location_id),
      user_no = coalesce(p_user_no, user_no)
  where id = p_user_id;
end;
$$;

create or replace function public.create_staff_member(
  p_full_name text, p_department text default null, p_phone text default null, p_pin text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  if nullif(trim(coalesce(p_full_name,'')), '') is null then
    raise exception 'Name is required.';
  end if;
  insert into public.users (full_name, department, phone, role, user_no)
  values (trim(p_full_name), nullif(trim(coalesce(p_department,'')),''),
          nullif(trim(coalesce(p_phone,'')),''), 'staff', public._next_user_no())
  returning id into v_id;
  if p_pin is not null then
    perform public.set_user_pin(v_id, p_pin);
  end if;
  return v_id;
end;
$$;

-- User IDs visible wherever names are shown.
create or replace view public.staff_directory as
select id, full_name, department, role, is_active, user_no
from public.users;
grant select on public.staff_directory to authenticated;
