-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0020 — Reimbursement claims
--
--  The third way somebody gets what they need. Ordering takes it off our
--  shelf; a request has us buy it; a claim is for when they bought it
--  themselves. That already happens — it was simply invisible, so there was
--  no record of the spending and no signal that our stocking had failed.
--
--  Money, not stock. A claim never touches the ledger: nothing arrived in a
--  store room, so there is nothing to count. Amounts are whole cents,
--  because decimal money drifts.
--
--  claims.reason is required and is the point of the exercise. Five people
--  separately buying whiteboard markers is a stocking failure, and until now
--  nobody could see it.
-- Run once, after 0019. Safe on a live database. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.claims (
  id           uuid primary key default gen_random_uuid(),
  claimed_by   uuid not null references public.users(id),
  zone         text,
  -- Why this wasn't ordered the usual way. Required: it's what feeds back
  -- into what we should be stocking.
  reason       text not null,
  status       text not null default 'requested'
                 check (status in ('requested','paid','declined')),
  admin_note   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.users(id)
);

create table if not exists public.claim_lines (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims(id) on delete cascade,
  description text not null,
  -- Whole cents. Never a float.
  amount_cents int not null check (amount_cents > 0),
  sort_order  int not null default 0
);

-- Receipts hang off the claim, not each line: one trip to the shop is one
-- receipt and five lines, and nobody should upload the same photo five times.
create table if not exists public.claim_receipts (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims(id) on delete cascade,
  -- Path within the private bucket. Not a public URL — there isn't one.
  path        text not null,
  file_name   text,
  uploaded_at timestamptz not null default now()
);

create index if not exists claims_claimant_idx on public.claims (claimed_by, created_at desc);
create index if not exists claims_status_idx on public.claims (status);
create index if not exists claim_lines_claim_idx on public.claim_lines (claim_id);
create index if not exists claim_receipts_claim_idx on public.claim_receipts (claim_id);

alter table public.claims enable row level security;
alter table public.claim_lines enable row level security;
alter table public.claim_receipts enable row level security;

-- Yours, or procurement's. A claim carries what somebody spent and what they
-- bought, so it is nobody else's business.
drop policy if exists claims_read on public.claims;
create policy claims_read on public.claims for select to authenticated
  using (claimed_by = auth.uid() or public.is_admin());

drop policy if exists claim_lines_read on public.claim_lines;
create policy claim_lines_read on public.claim_lines for select to authenticated
  using (exists (select 1 from public.claims c
                 where c.id = claim_id
                   and (c.claimed_by = auth.uid() or public.is_admin())));

drop policy if exists claim_receipts_read on public.claim_receipts;
create policy claim_receipts_read on public.claim_receipts for select to authenticated
  using (exists (select 1 from public.claims c
                 where c.id = claim_id
                   and (c.claimed_by = auth.uid() or public.is_admin())));

-- Receipts are attached from the app after the claim exists, so this one
-- insert is allowed directly. Everything else goes through the RPCs below.
drop policy if exists claim_receipts_insert on public.claim_receipts;
create policy claim_receipts_insert on public.claim_receipts for insert to authenticated
  with check (exists (select 1 from public.claims c
                      where c.id = claim_id
                        and c.claimed_by = auth.uid()
                        and c.status = 'requested'));

drop policy if exists claim_receipts_delete on public.claim_receipts;
create policy claim_receipts_delete on public.claim_receipts for delete to authenticated
  using (exists (select 1 from public.claims c
                 where c.id = claim_id
                   and c.claimed_by = auth.uid()
                   and c.status = 'requested'));

-- ── Raising one ────────────────────────────────────────────────────────────
create or replace function public.create_claim(
  p_zone text, p_reason text, p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_role text := public.current_user_role();
  v_claim_id uuid;
  v_line jsonb;
  v_desc text;
  v_amount int;
  v_total int := 0;
  v_count int := 0;
begin
  if v_role not in ('staff','dept_head','procurement','super_admin') then
    raise exception 'Not authorized.';
  end if;
  if nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'A reason for the purchase is required.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item.';
  end if;

  insert into public.claims (claimed_by, zone, reason)
  values (auth.uid(), nullif(trim(coalesce(p_zone,'')), ''), trim(p_reason))
  returning id into v_claim_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_desc := nullif(trim(coalesce(v_line->>'description','')), '');
    v_amount := nullif(v_line->>'amount_cents','')::int;
    if v_desc is null then
      raise exception 'Each line needs a description.';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Each line needs an amount greater than zero.';
    end if;
    insert into public.claim_lines (claim_id, description, amount_cents, sort_order)
    values (v_claim_id, v_desc, v_amount, v_count);
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'claim_id', v_claim_id, 'total_cents', v_total, 'line_count', v_count);
end;
$$;

grant execute on function public.create_claim(text, text, jsonb) to authenticated;

-- ── Second thoughts, while it's still yours ────────────────────────────────
create or replace function public.edit_claim(
  p_claim_id uuid, p_zone text, p_reason text, p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_claim public.claims;
  v_line jsonb;
  v_desc text;
  v_amount int;
  v_total int := 0;
  v_count int := 0;
begin
  select * into v_claim from public.claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found.';
  end if;
  if v_claim.claimed_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_claim.status <> 'requested' then
    raise exception 'This claim has already been settled — it can no longer be changed.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A claim needs at least one line. Cancel it instead.';
  end if;
  if nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'A reason for the purchase is required.';
  end if;

  delete from public.claim_lines where claim_id = p_claim_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_desc := nullif(trim(coalesce(v_line->>'description','')), '');
    v_amount := nullif(v_line->>'amount_cents','')::int;
    if v_desc is null then
      raise exception 'Each line needs a description.';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Each line needs an amount greater than zero.';
    end if;
    insert into public.claim_lines (claim_id, description, amount_cents, sort_order)
    values (p_claim_id, v_desc, v_amount, v_count);
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  end loop;

  update public.claims
  set zone = nullif(trim(coalesce(p_zone,'')), ''),
      reason = trim(p_reason),
      updated_at = now()
  where id = p_claim_id;

  return jsonb_build_object('total_cents', v_total, 'line_count', v_count);
end;
$$;

grant execute on function public.edit_claim(uuid, text, text, jsonb) to authenticated;

create or replace function public.cancel_claim(p_claim_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_claim public.claims;
begin
  select * into v_claim from public.claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found.';
  end if;
  if v_claim.claimed_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_claim.status <> 'requested' then
    raise exception 'This claim has already been settled.';
  end if;
  -- Lines and receipt rows go with it; the files themselves are tidied by
  -- the app, which is the only thing that can talk to storage.
  delete from public.claims where id = p_claim_id;
end;
$$;

grant execute on function public.cancel_claim(uuid) to authenticated;

-- ── Settling it ────────────────────────────────────────────────────────────
create or replace function public.set_claim_status(
  p_claim_id uuid, p_status text, p_admin_note text default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_claim public.claims;
begin
  perform public._require_admin();

  select * into v_claim from public.claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found.';
  end if;
  if p_status not in ('requested','paid','declined') then
    raise exception 'Unknown status "%".', p_status;
  end if;
  -- Turning somebody down without saying why is not an answer.
  if p_status = 'declined'
     and nullif(trim(coalesce(p_admin_note,'')), '') is null then
    raise exception 'A reason is required when declining a claim.';
  end if;

  update public.claims
  set status = p_status,
      admin_note = coalesce(nullif(trim(coalesce(p_admin_note,'')), ''), admin_note),
      decided_at = case when p_status = 'requested' then null else now() end,
      decided_by = case when p_status = 'requested' then null else auth.uid() end,
      updated_at = now()
  where id = p_claim_id;
end;
$$;

grant execute on function public.set_claim_status(uuid, text, text) to authenticated;

-- ── Receipts ───────────────────────────────────────────────────────────────
-- Private, unlike item-photos and request-photos. A receipt carries a name,
-- often an address, sometimes the last four digits of a card — none of which
-- should be readable by anyone who happens to have the URL.
insert into storage.buckets (id, name, public)
values ('claim-receipts', 'claim-receipts', false)
on conflict (id) do update set public = false;

-- Files live under the claimant's own user id, so the first path segment is
-- the whole of the ownership check.
drop policy if exists "own claim receipts readable" on storage.objects;
create policy "own claim receipts readable" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'claim-receipts'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );

drop policy if exists "own claim receipts writable" on storage.objects;
create policy "own claim receipts writable" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'claim-receipts' and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "own claim receipts removable" on storage.objects;
create policy "own claim receipts removable" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'claim-receipts'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );
