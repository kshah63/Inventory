-- Migration 0008 acceptance: kiosks are gone and nothing else broke.
-- Run after 0008 has been applied. Re-runnable.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ═══ The kiosk surface is gone ═══
select public.t_assert(
  (select count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'kiosk%' or p.proname like '%_kiosk_%'
          or p.proname = 'set_user_pin' or p.proname = 'create_staff_member')) = 0,
  'no kiosk or PIN functions are left');

select public.t_assert(
  to_regclass('public.kiosk_sessions') is null
    and to_regclass('public.pin_attempts') is null,
  'kiosk_sessions and pin_attempts are dropped');

select public.t_assert(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('pin_hash','pin_failed_attempts','pin_locked_until')) = 0,
  'the PIN columns are dropped from users');

-- Deliberately kept: dropping a column a running deploy still selects logs
-- everyone out until the new build ships.
select public.t_assert(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'users'
            and column_name = 'kiosk_location_id'),
  'users.kiosk_location_id is left in place, unused');

select public.t_assert(
  not exists (select 1 from public.users where role = 'kiosk' and is_active),
  'no active kiosk account remains');

-- ═══ …and the paths that touched those columns still work ═══
delete from auth.users where email = 'zz-newjoiner@mv.sg';

insert into auth.users (id, email, raw_user_meta_data)
values ('dddddddd-0000-0000-0000-000000000009', 'zz-newjoiner@mv.sg',
        '{"full_name":"New Joiner"}');
select public.t_assert(
  (select full_name from public.users where id = 'dddddddd-0000-0000-0000-000000000009')
    = 'New Joiner',
  'a new auth account still gets a profile');
select public.t_assert(
  (select user_no from public.users where id = 'dddddddd-0000-0000-0000-000000000009')
    is not null,
  'and is given a User ID');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';  -- super admin
select public.update_user_profile(
  p_user_id := 'dddddddd-0000-0000-0000-000000000009',
  p_role := 'dept_head',
  p_user_no := 1999);
select public.t_assert(
  (select role || ':' || user_no from public.users
   where id = 'dddddddd-0000-0000-0000-000000000009') = 'dept_head:1999',
  'a profile can still be moved to Department Head with a chosen User ID');

-- Clean up so the file can be run again.
delete from auth.users where email = 'zz-newjoiner@mv.sg';
delete from public.users where id = 'dddddddd-0000-0000-0000-000000000009';

reset test.uid;
select 'NO-KIOSK TESTS PASSED' as result;
