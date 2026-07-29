-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0005 — procurement@mathvision.com.sg as super admin, and
-- mutual protection between super admins
--
--  • The procurement mailbox gets full super admin powers (now, and
--    automatically if the account is created later).
--  • A super admin account can only be changed by its own owner. Super
--    admins can manage everyone else, but cannot demote, deactivate,
--    rename, reset the password of, or sign out another super admin —
--    so no super admin can lock another one out.
-- Run once, after 0004. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Promote the procurement mailbox if the account already exists.
update public.users u
set role = 'super_admin'
from auth.users au
where au.id = u.id
  and lower(au.email) = 'procurement@mathvision.com.sg'
  and u.role <> 'super_admin';

-- 2. …and promote it automatically if the account is created later.
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

  -- The procurement mailbox is always a super admin.
  if lower(coalesce(new.email, '')) = 'procurement@mathvision.com.sg' then
    v_role := 'super_admin';
  end if;

  -- Bootstrap: the very first non-kiosk account owns the system.
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

-- 3. Super admins are protected from each other: only the owner of a super
--    admin account may change it.
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
  if v_new_role not in ('super_admin','procurement','staff','dept_head','kiosk') then
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
      kiosk_location_id = coalesce(p_kiosk_location_id, kiosk_location_id),
      user_no = coalesce(p_user_no, user_no)
  where id = p_user_id;
end;
$$;

-- 4. Same protection for PIN resets (kiosk flow, dormant but still present).
create or replace function public.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_role text;
begin
  select role into v_role from public.users where id = p_user_id;
  if v_role is null then
    raise exception 'User not found.';
  end if;
  if v_role = 'super_admin' and p_user_id <> auth.uid() then
    raise exception 'Super admin accounts can only be changed by their owner.';
  end if;
  if not (public.is_super_admin() or auth.uid() = p_user_id) then
    raise exception 'Not authorized.';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4–6 digits.';
  end if;
  update public.users
  set pin_hash = crypt(p_pin, gen_salt('bf')),
      pin_failed_attempts = 0,
      pin_locked_until = null
  where id = p_user_id and role <> 'kiosk';
  if not found then
    raise exception 'User not found.';
  end if;
end;
$$;
