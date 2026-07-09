-- ═══════════════════════════════════════════════════════════════════════════
-- MathVision Procurement & Inventory Management System
-- Migration 0001 — schema, functions, RLS, seed data
--
-- Run this entire file in the Supabase SQL editor (or `supabase db push`).
-- It is idempotent-ish for development but intended to run once on a fresh
-- project.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. TABLES
-- ───────────────────────────────────────────────────────────────────────────

create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.items (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null unique,
  name              text not null,
  category_id       uuid not null references public.categories(id),
  unit              text not null default 'pcs',
  pack_size         int,
  photo_url         text,
  notes             text,
  max_per_checkout  int check (max_per_checkout is null or max_per_checkout > 0),
  requires_approval boolean not null default false,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create index items_category_idx on public.items (category_id);
create index items_active_idx on public.items (is_active);

-- User profiles. `id` matches auth.users.id when the person has a login;
-- kiosk-only staff (PIN users with no email login) get a standalone uuid.
create table public.users (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  role                text not null default 'staff'
                      check (role in ('super_admin','procurement','staff','kiosk')),
  department          text,
  phone               text, -- E.164, e.g. +6591234567 — used for WhatsApp notifications
  pin_hash            text,
  pin_failed_attempts int not null default 0,
  pin_locked_until    timestamptz,
  kiosk_location_id   uuid references public.locations(id), -- kiosk devices only
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

create table public.stock_levels (
  item_id       uuid not null references public.items(id),
  location_id   uuid not null references public.locations(id),
  qty_on_hand   int not null default 0 check (qty_on_hand >= 0),
  reorder_point int not null default 0 check (reorder_point >= 0),
  par_level     int not null default 0 check (par_level >= 0),
  updated_at    timestamptz not null default now(),
  primary key (item_id, location_id)
);

-- Immutable ledger. Never updated or deleted — corrections are new rows.
create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  type           text not null
                 check (type in ('checkout','return','receive','transfer_out','transfer_in','adjustment')),
  item_id        uuid not null references public.items(id),
  location_id    uuid not null references public.locations(id),
  qty_delta      int not null check (qty_delta <> 0),
  user_id        uuid not null references public.users(id),
  on_behalf_of   uuid references public.users(id),
  note           text,
  transfer_group uuid,
  created_at     timestamptz not null default now()
);

create index transactions_created_idx on public.transactions (created_at desc);
create index transactions_item_loc_idx on public.transactions (item_id, location_id, created_at desc);
create index transactions_user_idx on public.transactions (user_id, created_at desc);
create index transactions_type_idx on public.transactions (type);

create table public.requests (
  id             uuid primary key default gen_random_uuid(),
  requested_by   uuid not null references public.users(id),
  item_id        uuid references public.items(id),
  free_text_item text,
  qty            int not null check (qty > 0),
  location_id    uuid not null references public.locations(id),
  status         text not null default 'open'
                 check (status in ('open','acknowledged','ordered','fulfilled','rejected')),
  note           text,        -- requester's note
  admin_note     text,        -- procurement's note
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (item_id is not null or free_text_item is not null)
);

create index requests_status_idx on public.requests (status);
create index requests_requester_idx on public.requests (requested_by);

create table public.pending_checkouts (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items(id),
  location_id   uuid not null references public.locations(id),
  qty           int not null check (qty > 0),
  requested_by  uuid not null references public.users(id),
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid references public.users(id),
  decision_note text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

create index pending_checkouts_status_idx on public.pending_checkouts (status);

create table public.stocktakes (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations(id),
  performed_by uuid not null references public.users(id),
  note         text,
  created_at   timestamptz not null default now()
);

create table public.stocktake_lines (
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  item_id      uuid not null references public.items(id),
  system_qty   int not null,
  counted_qty  int not null,
  variance     int not null,
  primary key (stocktake_id, item_id)
);

-- Short-lived kiosk PIN sessions. The kiosk device account creates one per
-- staff PIN entry; all kiosk RPCs act through a valid session token so the
-- device account is never the actor of record.
create table public.kiosk_sessions (
  token         uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id),
  kiosk_user_id uuid not null references public.users(id),
  location_id   uuid not null references public.locations(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  ended_at      timestamptz
);

create index kiosk_sessions_expiry_idx on public.kiosk_sessions (expires_at);

create table public.pin_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id),
  kiosk_user_id uuid not null references public.users(id),
  success       boolean not null,
  created_at    timestamptz not null default now()
);

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.notifications_log (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null default 'whatsapp',
  recipient  text not null,
  kind       text not null, -- 'digest' | 'out_of_stock' | 'approval_needed' | 'approval_decided' | 'request_update'
  body       text not null,
  status     text not null default 'sent', -- 'sent' | 'failed' | 'skipped'
  error      text,
  created_at timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. HELPER FUNCTIONS (roles, triggers)
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.current_user_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.users where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_user_role() in ('super_admin','procurement'), false)
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_user_role() = 'super_admin', false)
$$;

-- Profile auto-creation when an auth user is created (invite or first sign-up).
-- The very first account ever created becomes super_admin (bootstrap).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_app_meta_data->>'role', 'staff');
  if v_role not in ('super_admin','procurement','staff','kiosk') then
    v_role := 'staff';
  end if;
  if v_role <> 'kiosk'
     and not exists (select 1 from public.users where role = 'super_admin') then
    v_role := 'super_admin';
  end if;
  insert into public.users (id, full_name, role, kiosk_location_id)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email, '@', 1)),
    v_role,
    nullif(new.raw_app_meta_data->>'kiosk_location_id','')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger requests_touch before update on public.requests
  for each row execute function public.touch_updated_at();

create trigger stock_levels_touch before update on public.stock_levels
  for each row execute function public.touch_updated_at();

-- Ledger immutability — belt and braces on top of missing RLS policies.
create or replace function public.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The transactions ledger is append-only. Record a compensating adjustment instead.';
end;
$$;

create trigger transactions_immutable
  before update or delete on public.transactions
  for each row execute function public.forbid_change();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. CORE STOCK MUTATION (internal — not callable from the API)
-- ───────────────────────────────────────────────────────────────────────────

-- Inserts a ledger row and updates stock_levels atomically, with a row lock
-- so concurrent checkouts of the last unit are serialized.
create or replace function public._apply_transaction(
  p_type text,
  p_item_id uuid,
  p_location_id uuid,
  p_qty_delta int,
  p_user_id uuid,
  p_note text default null,
  p_on_behalf_of uuid default null,
  p_transfer_group uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_qty int;
  v_item record;
  v_loc_name text;
  v_tx_id uuid;
begin
  if p_qty_delta = 0 then
    raise exception 'Quantity cannot be zero.';
  end if;

  select id, name, is_active into v_item from public.items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Item not found.';
  end if;

  -- Ensure a stock row exists, then lock it.
  insert into public.stock_levels (item_id, location_id)
  values (p_item_id, p_location_id)
  on conflict (item_id, location_id) do nothing;

  select qty_on_hand into v_qty
  from public.stock_levels
  where item_id = p_item_id and location_id = p_location_id
  for update;

  if v_qty + p_qty_delta < 0 then
    select name into v_loc_name from public.locations where id = p_location_id;
    if v_qty = 0 then
      raise exception 'Someone just took the last ones — 0 left of "%" at %.', v_item.name, v_loc_name;
    end if;
    raise exception 'Only % left of "%" at %.', v_qty, v_item.name, v_loc_name;
  end if;

  insert into public.transactions
    (type, item_id, location_id, qty_delta, user_id, on_behalf_of, note, transfer_group)
  values
    (p_type, p_item_id, p_location_id, p_qty_delta, p_user_id, p_on_behalf_of, nullif(trim(coalesce(p_note,'')), ''), p_transfer_group)
  returning id into v_tx_id;

  update public.stock_levels
  set qty_on_hand = qty_on_hand + p_qty_delta
  where item_id = p_item_id and location_id = p_location_id;

  return v_tx_id;
end;
$$;

-- Validates a kiosk session token: must exist, be unexpired, not ended, and
-- belong to the calling kiosk device account.
create or replace function public._get_kiosk_session(p_token uuid)
returns public.kiosk_sessions
language plpgsql stable security definer set search_path = public
as $$
declare
  v_session public.kiosk_sessions;
begin
  select * into v_session from public.kiosk_sessions where token = p_token;
  if v_session.token is null
     or v_session.ended_at is not null
     or v_session.expires_at < now()
     or v_session.kiosk_user_id <> auth.uid() then
    raise exception 'SESSION_EXPIRED';
  end if;
  -- A user deactivated mid-session loses the session immediately.
  if not exists (
    select 1 from public.users where id = v_session.user_id and is_active
  ) then
    raise exception 'SESSION_EXPIRED';
  end if;
  return v_session;
end;
$$;

create or replace function public._require_admin()
returns uuid
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  return auth.uid();
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. KIOSK RPCs
-- ───────────────────────────────────────────────────────────────────────────

-- Staff list for the kiosk user picker. Only users with a PIN set appear.
create or replace function public.kiosk_get_staff()
returns table (id uuid, full_name text, department text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.current_user_role() not in ('kiosk','procurement','super_admin') then
    raise exception 'Not authorized.';
  end if;
  return query
    select u.id, u.full_name, u.department
    from public.users u
    where u.is_active and u.role <> 'kiosk' and u.pin_hash is not null
    order by u.full_name;
end;
$$;

-- Verify PIN (bcrypt, rate-limited: 5 failures → 60s lockout) and open a
-- short-lived session bound to this kiosk device and its location.
--
-- IMPORTANT: auth failures are returned as {ok:false, error:...} rather than
-- raised — a raised exception would roll back the whole RPC transaction and
-- discard the failed-attempt counter, lockout, and audit writes, making the
-- rate limit dead code.
create or replace function public.kiosk_start_session(p_user_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_kiosk public.users;
  v_target public.users;
  v_token uuid;
begin
  select * into v_kiosk from public.users where id = auth.uid();
  if v_kiosk.id is null or v_kiosk.role <> 'kiosk' or not v_kiosk.is_active then
    raise exception 'This action is only available on a kiosk device.';
  end if;
  if v_kiosk.kiosk_location_id is null then
    raise exception 'This kiosk has no location assigned. Ask an admin to set it.';
  end if;

  select * into v_target from public.users where id = p_user_id for update;
  if v_target.id is null or not v_target.is_active or v_target.role = 'kiosk'
     or v_target.pin_hash is null then
    return jsonb_build_object('ok', false, 'error', 'PIN_INVALID');
  end if;

  if v_target.pin_locked_until is not null and v_target.pin_locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'PIN_LOCKED:' || ceil(extract(epoch from (v_target.pin_locked_until - now())))::int
    );
  end if;

  if v_target.pin_hash <> crypt(p_pin, v_target.pin_hash) then
    insert into public.pin_attempts (user_id, kiosk_user_id, success)
    values (p_user_id, auth.uid(), false);
    if v_target.pin_failed_attempts + 1 >= 5 then
      update public.users
      set pin_failed_attempts = 0, pin_locked_until = now() + interval '60 seconds'
      where id = p_user_id;
      return jsonb_build_object('ok', false, 'error', 'PIN_LOCKED:60');
    end if;
    update public.users
    set pin_failed_attempts = pin_failed_attempts + 1
    where id = p_user_id;
    return jsonb_build_object('ok', false, 'error', 'PIN_INVALID');
  end if;

  insert into public.pin_attempts (user_id, kiosk_user_id, success)
  values (p_user_id, auth.uid(), true);

  update public.users
  set pin_failed_attempts = 0, pin_locked_until = null
  where id = p_user_id;

  insert into public.kiosk_sessions (user_id, kiosk_user_id, location_id, expires_at)
  values (p_user_id, auth.uid(), v_kiosk.kiosk_location_id, now() + interval '5 minutes')
  returning token into v_token;

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'user_id', v_target.id,
    'full_name', v_target.full_name
  );
end;
$$;

create or replace function public.kiosk_end_session(p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.kiosk_sessions
  set ended_at = now()
  where token = p_token and kiosk_user_id = auth.uid() and ended_at is null;
end;
$$;

-- Basket checkout. p_lines: [{"item_id": "...", "qty": 2}, ...]
-- Rejects approval-required items, enforces per-checkout caps and stock,
-- and reports which items hit zero (for out-of-stock alerts).
create or replace function public.kiosk_checkout(p_token uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.kiosk_sessions;
  v_line jsonb;
  v_item public.items;
  v_qty int;
  v_lines jsonb;
  v_taken jsonb := '[]'::jsonb;
  v_zero jsonb := '[]'::jsonb;
  v_remaining int;
  v_other jsonb;
begin
  v_session := public._get_kiosk_session(p_token);

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing to check out.';
  end if;

  -- Merge duplicate lines per item so max_per_checkout applies to the item
  -- TOTAL (a direct caller could otherwise split one item across lines), and
  -- order by item so concurrent checkouts lock rows in a consistent order.
  select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'qty', s.qty) order by s.item_id)
  into v_lines
  from (
    select e->>'item_id' as item_id, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by 1
  ) s;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.';
    end if;

    select * into v_item from public.items where id = (v_line->>'item_id')::uuid;
    if v_item.id is null or not v_item.is_active then
      raise exception 'Item not found.';
    end if;
    if v_item.requires_approval then
      raise exception '"%" requires approval — use the Request approval button.', v_item.name;
    end if;
    if v_item.max_per_checkout is not null and v_qty > v_item.max_per_checkout then
      raise exception 'Max % % of "%" per checkout.', v_item.max_per_checkout, v_item.unit, v_item.name;
    end if;

    perform public._apply_transaction(
      'checkout', v_item.id, v_session.location_id, -v_qty, v_session.user_id);

    v_taken := v_taken || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'unit', v_item.unit, 'qty', v_qty);

    select qty_on_hand into v_remaining
    from public.stock_levels
    where item_id = v_item.id and location_id = v_session.location_id;

    if v_remaining = 0 then
      select coalesce(jsonb_agg(jsonb_build_object('location', l.name, 'qty', sl.qty_on_hand)), '[]'::jsonb)
      into v_other
      from public.stock_levels sl
      join public.locations l on l.id = sl.location_id
      where sl.item_id = v_item.id and sl.location_id <> v_session.location_id and sl.qty_on_hand > 0;

      v_zero := v_zero || jsonb_build_object(
        'item_id', v_item.id, 'name', v_item.name,
        'location', (select name from public.locations where id = v_session.location_id),
        'elsewhere', v_other);
    end if;
  end loop;

  -- Keep the session alive briefly so the user can continue (e.g. returns).
  update public.kiosk_sessions set expires_at = now() + interval '5 minutes'
  where token = p_token;

  return jsonb_build_object('taken', v_taken, 'hit_zero', v_zero);
end;
$$;

-- "I took too many" — positive ledger entry tagged return. Capped at the
-- user's own net checkouts of that item at this room (trailing 90 days) so
-- stock can't be inflated by "returning" items never taken.
create or replace function public.kiosk_return(p_token uuid, p_item_id uuid, p_qty int, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.kiosk_sessions;
  v_item public.items;
  v_net_taken int;
begin
  v_session := public._get_kiosk_session(p_token);
  if p_qty is null or p_qty <= 0 then
    raise exception 'Invalid quantity.';
  end if;
  select * into v_item from public.items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Item not found.';
  end if;

  select coalesce(sum(-qty_delta), 0) into v_net_taken
  from public.transactions
  where user_id = v_session.user_id
    and item_id = p_item_id
    and location_id = v_session.location_id
    and type in ('checkout','return')
    and created_at > now() - interval '90 days';

  if v_net_taken <= 0 then
    raise exception 'No recent checkout of "%" by you in this room — ask an admin to record an adjustment instead.', v_item.name;
  end if;
  if p_qty > v_net_taken then
    raise exception 'You can return at most % % of "%" (your recent checkouts here).', v_net_taken, v_item.unit, v_item.name;
  end if;

  perform public._apply_transaction(
    'return', p_item_id, v_session.location_id, p_qty, v_session.user_id, p_note);

  update public.kiosk_sessions set expires_at = now() + interval '5 minutes'
  where token = p_token;

  return jsonb_build_object('name', v_item.name, 'unit', v_item.unit, 'qty', p_qty);
end;
$$;

-- Approval-required item → pending_checkouts row for procurement to decide.
create or replace function public.kiosk_request_approval(p_token uuid, p_item_id uuid, p_qty int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.kiosk_sessions;
  v_item public.items;
  v_id uuid;
begin
  v_session := public._get_kiosk_session(p_token);
  if p_qty is null or p_qty <= 0 then
    raise exception 'Invalid quantity.';
  end if;
  select * into v_item from public.items where id = p_item_id;
  if v_item.id is null or not v_item.is_active then
    raise exception 'Item not found.';
  end if;
  if not v_item.requires_approval then
    raise exception '"%" does not need approval — just take it.', v_item.name;
  end if;
  if v_item.max_per_checkout is not null and p_qty > v_item.max_per_checkout then
    raise exception 'Max % % of "%" per checkout.', v_item.max_per_checkout, v_item.unit, v_item.name;
  end if;

  insert into public.pending_checkouts (item_id, location_id, qty, requested_by)
  values (p_item_id, v_session.location_id, p_qty, v_session.user_id)
  returning id into v_id;

  return jsonb_build_object(
    'pending_id', v_id,
    'item_name', v_item.name,
    'unit', v_item.unit,
    'qty', p_qty,
    'requester_name', (select full_name from public.users where id = v_session.user_id),
    'location_name', (select name from public.locations where id = v_session.location_id)
  );
end;
$$;

-- Out-of-stock / new-item request from the kiosk.
create or replace function public.kiosk_create_request(
  p_token uuid, p_item_id uuid, p_free_text text, p_qty int, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.kiosk_sessions;
  v_id uuid;
begin
  v_session := public._get_kiosk_session(p_token);
  if p_qty is null or p_qty <= 0 then
    raise exception 'Invalid quantity.';
  end if;
  if p_item_id is null and nullif(trim(coalesce(p_free_text,'')), '') is null then
    raise exception 'Pick an item or describe what you need.';
  end if;

  insert into public.requests (requested_by, item_id, free_text_item, qty, location_id, note)
  values (v_session.user_id, p_item_id, nullif(trim(coalesce(p_free_text,'')), ''), p_qty, v_session.location_id, p_note)
  returning id into v_id;

  return v_id;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. ADMIN / PROCUREMENT RPCs
-- ───────────────────────────────────────────────────────────────────────────

-- Bulk receive. p_lines: [{"item_id": "...", "qty": 50}, ...]
create or replace function public.receive_stock(p_location_id uuid, p_lines jsonb, p_note text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public._require_admin();
  v_line jsonb;
  v_qty int;
  v_count int := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing to receive.';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Received quantity must be positive.';
    end if;
    perform public._apply_transaction(
      'receive', (v_line->>'item_id')::uuid, p_location_id, v_qty, v_actor, p_note);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Atomic transfer between rooms: paired ledger rows linked by transfer_group.
create or replace function public.transfer_stock(
  p_item_id uuid, p_from_location uuid, p_to_location uuid, p_qty int, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public._require_admin();
  v_group uuid := gen_random_uuid();
begin
  if p_from_location = p_to_location then
    raise exception 'Source and destination must differ.';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Transfer quantity must be positive.';
  end if;
  perform public._apply_transaction(
    'transfer_out', p_item_id, p_from_location, -p_qty, v_actor, p_note, null, v_group);
  perform public._apply_transaction(
    'transfer_in', p_item_id, p_to_location, p_qty, v_actor, p_note, null, v_group);
  return v_group;
end;
$$;

-- Ad-hoc adjustment with a mandatory reason note.
create or replace function public.adjust_stock(
  p_item_id uuid, p_location_id uuid, p_qty_delta int, p_note text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public._require_admin();
begin
  if nullif(trim(coalesce(p_note,'')), '') is null then
    raise exception 'A reason note is required for adjustments.';
  end if;
  return public._apply_transaction(
    'adjustment', p_item_id, p_location_id, p_qty_delta, v_actor, p_note);
end;
$$;

-- Reorder point / par level maintenance (stock_levels rows created on demand).
create or replace function public.set_stock_params(
  p_item_id uuid, p_location_id uuid, p_reorder_point int, p_par_level int
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public._require_admin();
  if p_reorder_point < 0 or p_par_level < 0 then
    raise exception 'Reorder point and par level must be zero or more.';
  end if;
  insert into public.stock_levels (item_id, location_id, reorder_point, par_level)
  values (p_item_id, p_location_id, p_reorder_point, p_par_level)
  on conflict (item_id, location_id)
  do update set reorder_point = excluded.reorder_point, par_level = excluded.par_level;
end;
$$;

-- Approve / reject a pending (approval-required) checkout.
-- On approval the checkout transaction is recorded against the requester.
create or replace function public.decide_pending_checkout(
  p_id uuid, p_approve boolean, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public._require_admin();
  v_pc public.pending_checkouts;
  v_item public.items;
begin
  select * into v_pc from public.pending_checkouts where id = p_id for update;
  if v_pc.id is null then
    raise exception 'Approval request not found.';
  end if;
  if v_pc.status <> 'pending' then
    raise exception 'This request was already decided (%).', v_pc.status;
  end if;

  select * into v_item from public.items where id = v_pc.item_id;

  if p_approve then
    perform public._apply_transaction(
      'checkout', v_pc.item_id, v_pc.location_id, -v_pc.qty, v_pc.requested_by,
      'Approved checkout — ' || coalesce(nullif(trim(coalesce(p_note,'')),''), 'approved'),
      v_actor);
  end if;

  update public.pending_checkouts
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = v_actor,
      decision_note = nullif(trim(coalesce(p_note,'')), ''),
      decided_at = now()
  where id = p_id;

  return jsonb_build_object(
    'status', case when p_approve then 'approved' else 'rejected' end,
    'item_name', v_item.name,
    'unit', v_item.unit,
    'qty', v_pc.qty,
    'requester_id', v_pc.requested_by,
    'requester_name', (select full_name from public.users where id = v_pc.requested_by),
    'requester_phone', (select phone from public.users where id = v_pc.requested_by),
    'location_name', (select name from public.locations where id = v_pc.location_id)
  );
end;
$$;

-- Stocktake: submit counted quantities; variances become adjustment
-- transactions and a variance report is stored.
-- p_lines: [{"item_id": "...", "counted_qty": 12}, ...]
create or replace function public.apply_stocktake(p_location_id uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public._require_admin();
  v_line jsonb;
  v_counted int;
  v_system int;
  v_variance int;
  v_stocktake_id uuid;
  v_adjustments int := 0;
  v_label text;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'No counts submitted.';
  end if;

  insert into public.stocktakes (location_id, performed_by, note)
  values (p_location_id, v_actor, nullif(trim(coalesce(p_note,'')), ''))
  returning id into v_stocktake_id;

  v_label := 'Stocktake ' || to_char(now() at time zone 'Asia/Singapore', 'YYYY-MM-DD');

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_counted := (v_line->>'counted_qty')::int;
    if v_counted is null or v_counted < 0 then
      raise exception 'Counted quantity must be zero or more.';
    end if;

    insert into public.stock_levels (item_id, location_id)
    values ((v_line->>'item_id')::uuid, p_location_id)
    on conflict (item_id, location_id) do nothing;

    select qty_on_hand into v_system
    from public.stock_levels
    where item_id = (v_line->>'item_id')::uuid and location_id = p_location_id
    for update;

    v_variance := v_counted - v_system;

    insert into public.stocktake_lines (stocktake_id, item_id, system_qty, counted_qty, variance)
    values (v_stocktake_id, (v_line->>'item_id')::uuid, v_system, v_counted, v_variance);

    if v_variance <> 0 then
      perform public._apply_transaction(
        'adjustment', (v_line->>'item_id')::uuid, p_location_id, v_variance, v_actor,
        v_label || coalesce(' — ' || nullif(trim(coalesce(p_note,'')), ''), ''));
      v_adjustments := v_adjustments + 1;
    end if;
  end loop;

  return jsonb_build_object('stocktake_id', v_stocktake_id, 'adjustments', v_adjustments);
end;
$$;

-- CSV import — idempotent on SKU. p_rows:
-- [{"sku","name","category","unit","pack_size","max_per_checkout",
--   "requires_approval","notes",
--   "stock":[{"location","qty","reorder_point","par_level"}]}, ...]
-- qty null → leave stock untouched; qty set → adjust on-hand to match.
create or replace function public.import_catalog(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public._require_admin();
  v_row jsonb;
  v_stock jsonb;
  v_category_id uuid;
  v_item_id uuid;
  v_location_id uuid;
  v_qty int;
  v_on_hand int;
  v_created int := 0;
  v_updated int := 0;
  v_adjusted int := 0;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows to import.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if nullif(trim(coalesce(v_row->>'sku','')), '') is null
       or nullif(trim(coalesce(v_row->>'name','')), '') is null
       or nullif(trim(coalesce(v_row->>'category','')), '') is null then
      raise exception 'Each row needs sku, name and category (row: %).', coalesce(v_row->>'sku', v_row->>'name', '?');
    end if;

    select id into v_category_id from public.categories where lower(name) = lower(trim(v_row->>'category'));
    if v_category_id is null then
      insert into public.categories (name, sort_order)
      values (trim(v_row->>'category'), coalesce((select max(sort_order) from public.categories), 0) + 1)
      returning id into v_category_id;
    end if;

    select id into v_item_id from public.items where sku = trim(v_row->>'sku');
    if v_item_id is null then
      insert into public.items (sku, name, category_id, unit, pack_size, notes, max_per_checkout, requires_approval)
      values (
        trim(v_row->>'sku'),
        trim(v_row->>'name'),
        v_category_id,
        coalesce(nullif(trim(coalesce(v_row->>'unit','')),''), 'pcs'),
        nullif(v_row->>'pack_size','')::int,
        nullif(trim(coalesce(v_row->>'notes','')), ''),
        nullif(v_row->>'max_per_checkout','')::int,
        coalesce(nullif(trim(coalesce(v_row->>'requires_approval','')),'')::boolean, false)
      )
      returning id into v_item_id;
      v_created := v_created + 1;
    else
      update public.items
      set name = trim(v_row->>'name'),
          category_id = v_category_id,
          unit = coalesce(nullif(trim(coalesce(v_row->>'unit','')),''), unit),
          pack_size = coalesce(nullif(v_row->>'pack_size','')::int, pack_size),
          notes = coalesce(nullif(trim(coalesce(v_row->>'notes','')), ''), notes),
          max_per_checkout = coalesce(nullif(v_row->>'max_per_checkout','')::int, max_per_checkout),
          requires_approval = coalesce(nullif(trim(coalesce(v_row->>'requires_approval','')),'')::boolean, requires_approval),
          is_active = true
      where id = v_item_id;
      v_updated := v_updated + 1;
    end if;

    for v_stock in select * from jsonb_array_elements(coalesce(v_row->'stock', '[]'::jsonb)) loop
      select id into v_location_id from public.locations where lower(name) = lower(trim(v_stock->>'location'));
      if v_location_id is null then
        raise exception 'Unknown location "%" (row %).', v_stock->>'location', v_row->>'sku';
      end if;

      insert into public.stock_levels (item_id, location_id, reorder_point, par_level)
      values (
        v_item_id, v_location_id,
        coalesce(nullif(v_stock->>'reorder_point','')::int, 0),
        coalesce(nullif(v_stock->>'par_level','')::int, 0)
      )
      on conflict (item_id, location_id) do update
      set reorder_point = coalesce(nullif(v_stock->>'reorder_point','')::int, public.stock_levels.reorder_point),
          par_level = coalesce(nullif(v_stock->>'par_level','')::int, public.stock_levels.par_level);

      v_qty := nullif(v_stock->>'qty','')::int;
      if v_qty is not null then
        if v_qty < 0 then
          raise exception 'Stock quantity cannot be negative (row %).', v_row->>'sku';
        end if;
        select qty_on_hand into v_on_hand
        from public.stock_levels
        where item_id = v_item_id and location_id = v_location_id
        for update;
        if v_qty <> v_on_hand then
          perform public._apply_transaction(
            'adjustment', v_item_id, v_location_id, v_qty - v_on_hand, v_actor, 'CSV import');
          v_adjusted := v_adjusted + 1;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'stock_adjusted', v_adjusted);
end;
$$;

-- Set or reset a user's kiosk PIN (4–6 digits). Super admins can set anyone's;
-- staff can set their own from their own device.
create or replace function public.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
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

-- Create a kiosk-only staff member (PIN user without an email login).
create or replace function public.create_staff_member(
  p_full_name text, p_department text default null, p_phone text default null, p_pin text default null
) returns uuid
language plpgsql security definer set search_path = public
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
  insert into public.users (full_name, department, phone, role)
  values (trim(p_full_name), nullif(trim(coalesce(p_department,'')),''), nullif(trim(coalesce(p_phone,'')),''), 'staff')
  returning id into v_id;
  if p_pin is not null then
    perform public.set_user_pin(v_id, p_pin);
  end if;
  return v_id;
end;
$$;

-- Update a user profile (super admin). Refuses to deactivate/demote the last
-- active super admin.
create or replace function public.update_user_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_department text default null,
  p_phone text default null,
  p_role text default null,
  p_is_active boolean default null,
  p_kiosk_location_id uuid default null
) returns void
language plpgsql security definer set search_path = public
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
  if v_new_role not in ('super_admin','procurement','staff','kiosk') then
    raise exception 'Invalid role.';
  end if;
  if v_user.role = 'super_admin'
     and (v_new_role <> 'super_admin' or not v_new_active)
     and (select count(*) from public.users where role = 'super_admin' and is_active) <= 1 then
    raise exception 'Cannot remove the last active super admin.';
  end if;

  update public.users
  set full_name = coalesce(nullif(trim(coalesce(p_full_name,'')),''), full_name),
      department = coalesce(p_department, department),
      phone = coalesce(p_phone, phone),
      role = v_new_role,
      is_active = v_new_active,
      kiosk_location_id = coalesce(p_kiosk_location_id, kiosk_location_id)
  where id = p_user_id;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. DASHBOARDS & REPORTS
-- ───────────────────────────────────────────────────────────────────────────

-- Items at/below reorder point (reorder_point > 0), with suggested order qty
-- and days-to-stockout from trailing 30-day consumption.
create or replace function public.get_reorder_dashboard()
returns table (
  item_id uuid, sku text, item_name text, category_name text, unit text,
  location_id uuid, location_name text,
  qty_on_hand int, reorder_point int, par_level int, suggested_qty int,
  avg_daily_use numeric, days_to_stockout numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  with usage as (
    select t.item_id, t.location_id, sum(-t.qty_delta)::numeric / 30 as daily
    from public.transactions t
    where t.type = 'checkout' and t.created_at > now() - interval '30 days'
    group by t.item_id, t.location_id
  )
  select
    i.id, i.sku, i.name, c.name, i.unit,
    l.id, l.name,
    sl.qty_on_hand, sl.reorder_point, sl.par_level,
    greatest(sl.par_level - sl.qty_on_hand, 0),
    round(coalesce(u.daily, 0), 2),
    case when coalesce(u.daily, 0) > 0
         then round(sl.qty_on_hand / u.daily, 1)
         else null end
  from public.stock_levels sl
  join public.items i on i.id = sl.item_id and i.is_active
  join public.categories c on c.id = i.category_id
  join public.locations l on l.id = sl.location_id and l.is_active
  left join usage u on u.item_id = sl.item_id and u.location_id = sl.location_id
  where sl.reorder_point > 0 and sl.qty_on_hand <= sl.reorder_point
  order by (sl.qty_on_hand = 0) desc, l.name, i.name;
end;
$$;

create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public
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
    'pending_approvals', (select count(*) from public.pending_checkouts where status = 'pending'),
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

-- Net consumption (checkouts minus returns) grouped by user/item/category/department.
create or replace function public.report_consumption(
  p_from timestamptz, p_to timestamptz, p_group_by text
) returns table (group_key text, group_label text, total_qty bigint, tx_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_admin();
  if p_group_by not in ('user','item','category','department','location') then
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
    end,
    case p_group_by
      when 'user' then u.full_name || case when not u.is_active then ' (former staff)' else '' end
      when 'item' then i.name
      when 'category' then c.name
      when 'department' then coalesce(u.department, 'No department')
      when 'location' then l.name
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

-- Daily checkout volume for charts (in Asia/Singapore days).
create or replace function public.report_daily_usage(p_days int default 30)
returns table (day date, total_qty bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_admin();
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

-- Data for the WhatsApp daily digest / email fallback.
create or replace function public.get_digest_data()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized.';
  end if;
  select jsonb_build_object(
    'low_stock', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select i.name as item_name, i.unit, l.name as location_name,
             sl.qty_on_hand, sl.reorder_point,
             greatest(sl.par_level - sl.qty_on_hand, 0) as suggested_qty
      from public.stock_levels sl
      join public.items i on i.id = sl.item_id and i.is_active
      join public.locations l on l.id = sl.location_id
      where sl.reorder_point > 0 and sl.qty_on_hand <= sl.reorder_point
      order by (sl.qty_on_hand = 0) desc, l.name, i.name
    ) x),
    'open_requests', (select count(*) from public.requests where status in ('open','acknowledged')),
    'pending_approvals', (select count(*) from public.pending_checkouts where status = 'pending')
  ) into v_result;
  return v_result;
end;
$$;

-- Audit-log view with names joined; RLS of the underlying tables applies.
create or replace view public.v_transactions
with (security_invoker = on)
as
select
  t.id, t.type, t.qty_delta, t.note, t.transfer_group, t.created_at,
  t.item_id, i.sku, i.name as item_name, i.unit,
  t.location_id, l.name as location_name,
  t.user_id,
  -- Left joins: staff can see ledger rows recorded on their behalf even
  -- though RLS hides the acting admin's user row from them.
  coalesce(
    case when u.is_active then u.full_name else 'Former staff — ' || u.full_name end,
    'Staff member'
  ) as user_name,
  t.on_behalf_of,
  ob.full_name as on_behalf_of_name,
  c.name as category_name
from public.transactions t
join public.items i on i.id = t.item_id
join public.categories c on c.id = i.category_id
join public.locations l on l.id = t.location_id
left join public.users u on u.id = t.user_id
left join public.users ob on ob.id = t.on_behalf_of;

-- Safe user directory (no PIN hashes / phone numbers) for name display.
create or replace view public.staff_directory as
select id, full_name, department, role, is_active
from public.users;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. ROW-LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────

alter table public.locations enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.users enable row level security;
alter table public.stock_levels enable row level security;
alter table public.transactions enable row level security;
alter table public.requests enable row level security;
alter table public.pending_checkouts enable row level security;
alter table public.stocktakes enable row level security;
alter table public.stocktake_lines enable row level security;
alter table public.kiosk_sessions enable row level security;
alter table public.pin_attempts enable row level security;
alter table public.settings enable row level security;
alter table public.notifications_log enable row level security;

-- Catalog data: readable by every signed-in role (incl. kiosk devices).
create policy locations_read on public.locations for select to authenticated using (true);
create policy categories_read on public.categories for select to authenticated using (true);
create policy items_read on public.items for select to authenticated using (true);
create policy stock_read on public.stock_levels for select to authenticated using (true);

-- Catalog management: procurement + super admin. (Stock mutations are
-- RPC-only — there are deliberately NO insert/update policies on
-- stock_levels or transactions.)
create policy items_admin_insert on public.items for insert to authenticated
  with check (public.is_admin());
create policy items_admin_update on public.items for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy categories_admin_insert on public.categories for insert to authenticated
  with check (public.is_admin());
create policy categories_admin_update on public.categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy locations_admin_update on public.locations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy locations_admin_insert on public.locations for insert to authenticated
  with check (public.is_admin());

-- Users: self + admins can read full rows (others use staff_directory view).
create policy users_read on public.users for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Transactions: own history for staff; everything for admins. Writes via RPC only.
create policy transactions_read on public.transactions for select to authenticated
  using (user_id = auth.uid() or on_behalf_of = auth.uid() or public.is_admin());

-- Requests: staff manage their own; admins manage all.
create policy requests_read on public.requests for select to authenticated
  using (requested_by = auth.uid() or public.is_admin());
create policy requests_insert_own on public.requests for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'open'
    and public.current_user_role() in ('staff','procurement','super_admin')
  );
create policy requests_update_own on public.requests for update to authenticated
  using (requested_by = auth.uid() and status = 'open')
  with check (requested_by = auth.uid());
create policy requests_admin_update on public.requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy requests_delete_own on public.requests for delete to authenticated
  using (requested_by = auth.uid() and status = 'open');

-- Pending checkouts: requester + admins can read; writes via RPC only.
create policy pending_read on public.pending_checkouts for select to authenticated
  using (requested_by = auth.uid() or public.is_admin());

-- Stocktakes: admins read; writes via RPC.
create policy stocktakes_read on public.stocktakes for select to authenticated
  using (public.is_admin());
create policy stocktake_lines_read on public.stocktake_lines for select to authenticated
  using (public.is_admin());

-- Settings & notification log: admins only.
create policy settings_admin_all on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy notifications_read on public.notifications_log for select to authenticated
  using (public.is_admin());
create policy notifications_insert on public.notifications_log for insert to authenticated
  with check (public.is_admin());

-- kiosk_sessions / pin_attempts: no policies — clients can never touch them;
-- SECURITY DEFINER functions handle everything.

-- Lock down internal functions so PostgREST cannot call them.
revoke execute on function public._apply_transaction(text, uuid, uuid, int, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._get_kiosk_session(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.forbid_change() from public, anon, authenticated;

-- Grants for views.
grant select on public.staff_directory to authenticated;
grant select on public.v_transactions to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. STORAGE (item photos)
-- ───────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

create policy "item photos are public" on storage.objects
  for select using (bucket_id = 'item-photos');
create policy "admins manage item photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'item-photos' and public.is_admin());
create policy "admins update item photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'item-photos' and public.is_admin());
create policy "admins delete item photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'item-photos' and public.is_admin());

-- ───────────────────────────────────────────────────────────────────────────
-- 9. REALTIME (live stock counts on kiosks)
-- ───────────────────────────────────────────────────────────────────────────

do $$
begin
  alter publication supabase_realtime add table public.stock_levels;
exception when duplicate_object then null;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 10. SEED DATA
-- ───────────────────────────────────────────────────────────────────────────

insert into public.locations (name) values ('Level 8'), ('Basement')
on conflict (name) do nothing;

insert into public.categories (name, sort_order) values
  ('Stationery', 1),
  ('Printing & Paper', 2),
  ('Pantry', 3),
  ('Cleaning', 4),
  ('Teaching Materials', 5),
  ('IT Consumables', 6),
  ('First Aid', 7),
  ('Miscellaneous', 8)
on conflict (name) do nothing;

insert into public.settings (key, value) values
  ('whatsapp_recipients', '[]'::jsonb),
  ('digest_enabled', 'true'::jsonb),
  ('alerts_enabled', 'true'::jsonb)
on conflict (key) do nothing;
