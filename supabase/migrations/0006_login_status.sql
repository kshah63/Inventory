-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0006 — see which people actually have a login
--
-- Profiles created before ID logins (or added straight into the table) have
-- no account in auth.users, so they cannot sign in and have no password to
-- reset. The Users screen needs to show that plainly.
-- Run once, after 0005. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_login_status()
returns table (id uuid, login_email text)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  return query select au.id, au.email::text from auth.users au;
end;
$$;
