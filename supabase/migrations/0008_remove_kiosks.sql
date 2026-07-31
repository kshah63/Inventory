-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0008 — There are no kiosks
--
--  The pilot ran on shared kiosk tablets. The procurement room is locked now
--  and everyone pre-orders from their own device, so kiosk devices, their PIN
--  sign-in and the sessions behind them are all removed.
--
--  Checkout history stays: ledger rows recorded at a kiosk keep pointing at
--  the person they were recorded for, and any kiosk profile still referenced
--  by history is retired in place rather than deleted, so nothing orphans.
-- Run once, after 0007. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Drop the kiosk-only surface first. Several of these are security definer
--    functions that move stock; with no devices left they only widen what a
--    signed-in account can reach, and the two tables hold the foreign keys
--    that would otherwise pin the device profiles in place.
drop function if exists public.kiosk_checkout(uuid, jsonb, text);
drop function if exists public.kiosk_checkout(uuid, jsonb);
drop function if exists public.kiosk_return(uuid, uuid, int, text);
drop function if exists public.kiosk_request_approval(uuid, uuid, int);
drop function if exists public.kiosk_create_request(uuid, uuid, text, int, text);
drop function if exists public.kiosk_start_session(uuid, text);
drop function if exists public.kiosk_end_session(uuid);
drop function if exists public.kiosk_get_staff();
drop function if exists public._get_kiosk_session(uuid);
drop function if exists public.set_user_pin(uuid, text);
drop function if exists public.create_staff_member(text, text, text, text);

drop table if exists public.kiosk_sessions;
drop table if exists public.pin_attempts;

-- 2. No device can sign in. public.users has no foreign key to auth.users,
--    so the profiles are dealt with separately below.
delete from auth.users
where id in (select id from public.users where role = 'kiosk');

-- 3. Kiosk profiles that never recorded anything simply go.
delete from public.users u
where u.role = 'kiosk'
  and not exists (select 1 from public.transactions t
                  where t.user_id = u.id or t.on_behalf_of = u.id)
  and not exists (select 1 from public.pending_checkouts p where p.requested_by = u.id)
  and not exists (select 1 from public.requests r where r.requested_by = u.id)
  and not exists (select 1 from public.orders o where o.requested_by = u.id);

-- 4. Any that the ledger still points at are retired instead.
update public.users
set is_active = false,
    pin_hash = null,
    pin_failed_attempts = 0,
    pin_locked_until = null,
    kiosk_location_id = null
where role = 'kiosk';

-- 5. Rebuild the two functions that touched the kiosk columns, before those
--    columns disappear underneath them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_role text;
begin
  -- Note: Supabase Auth writes app_metadata after this trigger runs, so what
  -- arrives here is usually just the default. The app sets the role and User
  -- ID itself straight after creating the account — this is the safe floor.
  v_role := coalesce(new.raw_app_meta_data->>'role', 'staff');
  if v_role not in ('super_admin','procurement','staff','dept_head') then
    v_role := 'staff';
  end if;

  -- The procurement mailbox is always a super admin.
  if lower(coalesce(new.email, '')) = 'procurement@mathvision.com.sg' then
    v_role := 'super_admin';
  end if;

  -- Bootstrap: the very first account owns the system.
  if not exists (select 1 from public.users where role = 'super_admin') then
    v_role := 'super_admin';
  end if;

  insert into public.users (id, full_name, role, user_no)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email, '@', 1)),
    v_role,
    coalesce(nullif(new.raw_app_meta_data->>'user_no','')::int, public._next_user_no())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- p_kiosk_location_id is kept in the signature and ignored: a deploy of the
-- app that still passes it must not start erroring the moment this runs.
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

  -- No super admin may act on another super admin's account.
  if v_user.role = 'super_admin' and p_user_id <> auth.uid() then
    raise exception 'Super admin accounts can only be changed by their owner.';
  end if;

  v_new_role := coalesce(p_role, v_user.role);
  v_new_active := coalesce(p_is_active, v_user.is_active);
  if v_new_role not in ('super_admin','procurement','staff','dept_head') then
    raise exception 'Invalid role.';
  end if;
  -- Never leave the system without an active super admin.
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
      user_no = coalesce(p_user_no, user_no)
  where id = p_user_id;
end;
$$;

-- 6. The kiosk columns go last, once nothing reads them.
alter table public.users drop column if exists pin_hash;
alter table public.users drop column if exists pin_failed_attempts;
alter table public.users drop column if exists pin_locked_until;
alter table public.users drop column if exists kiosk_location_id;

-- 7. Stop new kiosk accounts appearing. If a retired profile had to be kept
--    for its history, the old check stays so that row remains valid.
do $$
begin
  if exists (select 1 from public.users where role = 'kiosk') then
    raise notice 'Kiosk profiles kept for their history — role check left as is.';
  else
    alter table public.users drop constraint if exists users_role_check;
    alter table public.users add constraint users_role_check
      check (role in ('super_admin','procurement','staff','dept_head'));
  end if;
end $$;
