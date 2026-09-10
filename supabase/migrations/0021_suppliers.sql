-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0021 — The supplier master
--
--  QuickBooks held 250 supplier names for what turned out to be ~120 real
--  suppliers. The portal now owns the register: groups (24100–24999), coded
--  sub-groups within them, suppliers with permanent codes, and every old
--  QuickBooks spelling kept as a searchable alias so the history stays
--  findable. The portal is the master; QuickBooks follows it.
--
--  Coding rules, as approved:
--    • Rent (24100): blocks of ten per location — header 1x0, suppliers
--      1x1–1x9. Everything else: blocks of one hundred — header x00,
--      suppliers x01–x99.
--    • A new supplier takes the next number in its sub-group, always past
--      the highest ever issued. Codes are permanent: retiring a supplier
--      never frees its number, because the accounts already reference it.
--    • The header number is never a supplier.
--
--  Admin-only in the database, not just the sidebar: the register names who
--  we pay, so staff accounts can't read it at all.
-- Run once, after 0020. Safe on a live database. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.supplier_groups (
  code int primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_subgroups (
  id uuid primary key default gen_random_uuid(),
  group_code int not null references public.supplier_groups(code),
  -- The block: code_start is the header and is never assigned to a
  -- supplier; suppliers live at code_start+1 .. code_end.
  code_start int not null check (code_start > 0),
  code_end int not null,
  name text not null,
  created_at timestamptz not null default now(),
  check (code_end >= code_start),
  unique (group_code, code_start)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  subgroup_id uuid not null references public.supplier_subgroups(id),
  group_code int not null references public.supplier_groups(code),
  sub_code int not null,
  name text not null,
  status text not null default 'active' check (status in ('active','retired')),
  notes text,
  created_at timestamptz not null default now(),
  unique (group_code, sub_code)
);

-- The same name twice in one group is how the duplicates happened last time.
create unique index if not exists suppliers_group_name_key
  on public.suppliers (group_code, lower(name));

create table if not exists public.supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  -- An old QuickBooks spelling, kept so anyone can search it and land on
  -- the right supplier and code.
  alias text not null,
  alias_key text generated always as (lower(alias)) stored,
  old_code text,
  created_at timestamptz not null default now(),
  unique (alias_key)
);

create index if not exists suppliers_subgroup_idx on public.suppliers (subgroup_id, sub_code);
create index if not exists supplier_aliases_supplier_idx on public.supplier_aliases (supplier_id);

alter table public.supplier_groups enable row level security;
alter table public.supplier_subgroups enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_aliases enable row level security;

-- Who we pay is the central team's business only.
drop policy if exists supplier_groups_read on public.supplier_groups;
create policy supplier_groups_read on public.supplier_groups
  for select to authenticated using (public.is_admin());
drop policy if exists supplier_subgroups_read on public.supplier_subgroups;
create policy supplier_subgroups_read on public.supplier_subgroups
  for select to authenticated using (public.is_admin());
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers
  for select to authenticated using (public.is_admin());
drop policy if exists supplier_aliases_read on public.supplier_aliases;
create policy supplier_aliases_read on public.supplier_aliases
  for select to authenticated using (public.is_admin());
-- No insert/update/delete policies: every write goes through the functions
-- below, which is where the coding rules live.

-- ── Adding a supplier: the code is assigned, never chosen ─────────────────
create or replace function public.add_supplier(
  p_subgroup_id uuid, p_name text, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_sg public.supplier_subgroups;
  v_name text := trim(coalesce(p_name, ''));
  v_dup public.suppliers;
  v_code int;
  v_id uuid;
begin
  perform public._require_admin();
  if v_name = '' then
    raise exception 'The supplier needs a name.';
  end if;

  -- Locked so two admins adding at once can't be issued the same code.
  select * into v_sg from public.supplier_subgroups
  where id = p_subgroup_id for update;
  if v_sg.id is null then
    raise exception 'Sub-group not found.';
  end if;

  -- The duplicates problem, stopped at the door: same name in this group,
  -- or a known old QuickBooks spelling of an existing supplier.
  select s.* into v_dup from public.suppliers s
  where s.group_code = v_sg.group_code and lower(s.name) = lower(v_name);
  if v_dup.id is not null then
    raise exception '"%" already exists in this group as %-%.',
      v_dup.name, v_dup.group_code, v_dup.sub_code;
  end if;
  select s.* into v_dup
  from public.supplier_aliases a join public.suppliers s on s.id = a.supplier_id
  where a.alias_key = lower(v_name);
  if v_dup.id is not null then
    raise exception '"%" is a known old name of % (%-%).',
      v_name, v_dup.name, v_dup.group_code, v_dup.sub_code;
  end if;

  -- Always past the highest ever issued, so a retired supplier's number is
  -- never handed to somebody new.
  select coalesce(max(sub_code), v_sg.code_start) + 1 into v_code
  from public.suppliers where subgroup_id = p_subgroup_id;
  if v_code > v_sg.code_end then
    raise exception 'Sub-group "%" is full (codes %–%). Add a new sub-group.',
      v_sg.name, v_sg.code_start + 1, v_sg.code_end;
  end if;

  insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
  values (p_subgroup_id, v_sg.group_code, v_code, v_name,
          nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  return jsonb_build_object(
    'supplier_id', v_id,
    'full_code', v_sg.group_code || '-' || v_code,
    'name', v_name);
end;
$$;

grant execute on function public.add_supplier(uuid, text, text) to authenticated;

-- ── Renaming, annotating, retiring. The code never changes. ───────────────
create or replace function public.update_supplier(
  p_supplier_id uuid, p_name text, p_notes text, p_status text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
begin
  perform public._require_admin();
  if v_name = '' then
    raise exception 'The supplier needs a name.';
  end if;
  if p_status not in ('active','retired') then
    raise exception 'Unknown status "%".', p_status;
  end if;
  update public.suppliers
  set name = v_name,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      status = p_status
  where id = p_supplier_id;
  if not found then
    raise exception 'Supplier not found.';
  end if;
exception
  when unique_violation then
    raise exception 'Another supplier in this group already has that name.';
end;
$$;

grant execute on function public.update_supplier(uuid, text, text, text) to authenticated;

-- ── Teaching it another old name ──────────────────────────────────────────
create or replace function public.add_supplier_alias(
  p_supplier_id uuid, p_alias text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_alias text := trim(coalesce(p_alias, ''));
  v_owner public.suppliers;
begin
  perform public._require_admin();
  if v_alias = '' then
    raise exception 'The alias is empty.';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Supplier not found.';
  end if;
  select s.* into v_owner
  from public.supplier_aliases a join public.suppliers s on s.id = a.supplier_id
  where a.alias_key = lower(v_alias);
  if v_owner.id is not null then
    raise exception 'That name already points at % (%-%).',
      v_owner.name, v_owner.group_code, v_owner.sub_code;
  end if;
  insert into public.supplier_aliases (supplier_id, alias) values (p_supplier_id, v_alias);
end;
$$;

grant execute on function public.add_supplier_alias(uuid, text) to authenticated;

-- ── A new sub-group claims the next free aligned block ────────────────────
create or replace function public.add_supplier_subgroup(
  p_group_code int, p_name text, p_width int
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_start int;
  v_id uuid;
begin
  perform public._require_admin();
  if v_name = '' then
    raise exception 'The sub-group needs a name.';
  end if;
  if p_width not in (10, 100) then
    raise exception 'Blocks are of ten or of one hundred.';
  end if;
  if not exists (select 1 from public.supplier_groups where code = p_group_code) then
    raise exception 'Group not found.';
  end if;

  -- Serialise per group, then take the first aligned block that doesn't
  -- overlap anything already claimed.
  perform 1 from public.supplier_groups where code = p_group_code for update;
  select coalesce(max(code_end), 0) into v_start
  from public.supplier_subgroups where group_code = p_group_code;
  v_start := ((v_start / p_width) + 1) * p_width;
  if v_start + p_width - 1 > 999 then
    raise exception 'Group % has no room left for a block of %.', p_group_code, p_width;
  end if;

  insert into public.supplier_subgroups (group_code, code_start, code_end, name)
  values (p_group_code, v_start, v_start + p_width - 1, v_name)
  returning id into v_id;

  return jsonb_build_object(
    'subgroup_id', v_id,
    'code_start', v_start,
    'code_end', v_start + p_width - 1);
end;
$$;

grant execute on function public.add_supplier_subgroup(int, text, int) to authenticated;

-- ═══ Recode 24150 Power, Water & Energy (runs before the seed) ═════════════
-- SP Digital leads the block at 101 so the SP accounts run 101–105, and
-- Senoko — a former private provider unlikely to be used again — parks at
-- 150, so its number can be retired without leaving a hole in the SP run.
-- On a database seeded with the old codes these moves happen here, BEFORE
-- the seed inserts below, so the seed then no-ops cleanly; on a fresh
-- database the seed writes the new codes directly and these do nothing.
-- Each step matches name + old code, so a second run is a no-op too.
-- SP Digital goes through a parking code because 101 is still occupied
-- until SP Services has moved off it.
update public.suppliers set sub_code = 150
  where group_code = 24150 and name = 'SENOKO ENERGY' and sub_code = 106;
update public.suppliers set sub_code = 9105
  where group_code = 24150 and name = 'SP DIGITAL' and sub_code = 105;
update public.suppliers set sub_code = 105
  where group_code = 24150 and name = 'SP SERVICES (OT LEVEL 24)' and sub_code = 104;
update public.suppliers set sub_code = 104
  where group_code = 24150 and name = 'SP SERVICES (OT LEVEL 8)' and sub_code = 103;
update public.suppliers set sub_code = 103
  where group_code = 24150 and name = 'SP SERVICES (OT BASEMENT)' and sub_code = 102;
update public.suppliers set sub_code = 102
  where group_code = 24150 and name = 'SP SERVICES' and sub_code = 101;
update public.suppliers set sub_code = 101
  where group_code = 24150 and name = 'SP DIGITAL' and sub_code = 9105;

-- ═══ Dissolve Office Equipment (24250 400s) — runs before the seed ═════════
-- Yoke sells mainly office chairs, so it belongs in Furniture & Fittings;
-- Zener DIY joins Hardware & Electrical Retail rather than holding a
-- sub-group alone. Each move takes the next free number in its new home
-- (not a hard-coded one), so a database that gained suppliers through the
-- portal since 0021 first ran still converges. Aliases follow the
-- supplier's id untouched. On a fresh database these match nothing and
-- the seed below places both directly; the 400 block is never created.
update public.suppliers y set
    group_code = 24200,
    subgroup_id = sg.id,
    sub_code = (select coalesce(max(s.sub_code), sg.code_start) + 1
                from public.suppliers s where s.subgroup_id = sg.id)
from public.supplier_subgroups sg
where sg.group_code = 24200 and sg.code_start = 100
  and y.group_code = 24250 and y.sub_code = 401
  and y.name = 'YOKE OFFICE EQUIPMENT';

update public.suppliers z set
    subgroup_id = sg.id,
    sub_code = (select coalesce(max(s.sub_code), sg.code_start) + 1
                from public.suppliers s where s.subgroup_id = sg.id)
from public.supplier_subgroups sg
where sg.group_code = 24250 and sg.code_start = 300
  and z.group_code = 24250 and z.sub_code = 402
  and z.name = 'ZENER DIY';

-- Drop the emptied sub-group. The not-exists guard keeps it if anything
-- else was added to it in the meantime — then it simply stays visible in
-- the portal for a human decision.
delete from public.supplier_subgroups sg
where sg.group_code = 24250 and sg.code_start = 400
  and sg.name = 'Office Equipment'
  and not exists (select 1 from public.suppliers s where s.subgroup_id = sg.id);

-- ═══ Move Goh Sin Huat to White Goods & Appliances (runs before the seed) ══
-- The vendor supplies and services white goods, so it belongs in its own
-- sub-group, not Hardware & Electrical Retail. Pre-launch we recode the whole
-- affected block rather than leave a vacated number: Goh leaves 24250-307 for
-- 24250-201, and the rest of Hardware & Electrical Retail shifts down to close
-- the gap (301–310, contiguous). Aliases follow the supplier id untouched.
--
-- The whole block is guarded on Goh still sitting at 307 — the already-seeded
-- pre-move state. On a fresh database Goh doesn't exist yet, so this is skipped
-- and the seed below places everything directly (and creates the group before
-- the sub-group, which the FK requires). On a database already converged, Goh
-- is at 201, so this is skipped too. That makes it safe to re-run.
do $$
declare v_wg uuid;
begin
  if exists (
    select 1 from public.suppliers
    where group_code = 24250 and sub_code = 307 and name = 'GOH SIN HUAT ELECTRICAL'
  ) then
    insert into public.supplier_subgroups (group_code, code_start, code_end, name)
    values (24250, 200, 299, 'White Goods & Appliances')
    on conflict (group_code, code_start) do nothing;

    select id into v_wg from public.supplier_subgroups
    where group_code = 24250 and code_start = 200;

    -- Goh out first, freeing 307.
    update public.suppliers
    set subgroup_id = v_wg, sub_code = 201
    where group_code = 24250 and sub_code = 307 and name = 'GOH SIN HUAT ELECTRICAL';

    -- Close the gap, ascending so each target is already free.
    update public.suppliers set sub_code = 307 where group_code = 24250 and sub_code = 308;
    update public.suppliers set sub_code = 308 where group_code = 24250 and sub_code = 309;
    update public.suppliers set sub_code = 309 where group_code = 24250 and sub_code = 310;
    update public.suppliers set sub_code = 310 where group_code = 24250 and sub_code = 311;
  end if;
end $$;

-- ═══ Seed: the approved master, verbatim ═══════════════════════════════════
-- Generated from MV Suppliers Master v2 (approved) — do not hand-edit.

insert into public.supplier_groups (code, name) values

  (24100, 'Rent Landlords & Building Management'),
  (24150, 'Utilities & Facilities'),
  (24200, 'Furniture & Fittings'),
  (24250, 'Equipment & Electronics'),
  (24300, 'Printing, Stationery & Learning Materials'),
  (24350, 'Software & Subscriptions'),
  (24400, 'Professional Services'),
  (24450, 'Administration, Insurance & Banking'),
  (24500, 'Levies, Contributions, Taxes'),
  (24550, 'Marketing & Business Development'),
  (24600, 'Pantry, Catering & Staff Welfare'),
  (24700, 'Multipurpose Retailer'),
  (24750, 'Suppliers - Other'),
  (24998, 'Student Refund'),
  (24999, 'Employee Reimbursement')
on conflict (code) do nothing;

insert into public.supplier_subgroups (group_code, code_start, code_end, name) values

  (24100, 110, 119, 'Dormant / Former Locations'),
  (24100, 120, 129, 'Tekka'),
  (24100, 130, 139, 'Orchard Towers'),
  (24100, 140, 149, 'Mezzo'),
  (24100, 150, 159, 'Raintree'),
  (24150, 100, 199, 'Power, Water & Energy'),
  (24150, 200, 299, 'Telecoms & Internet'),
  (24150, 300, 399, 'Fire Safety & Compliance'),
  (24150, 400, 499, 'Repairs & Maintenance'),
  (24150, 500, 599, 'Cleaning & Pest Control'),
  (24150, 600, 699, 'Signage Works'),
  (24200, 100, 199, 'Furniture & Fittings — General'),
  (24250, 100, 199, 'Computers & IT Equipment'),
  (24250, 200, 299, 'White Goods & Appliances'),
  (24250, 300, 399, 'Hardware & Electrical Retail'),
  (24300, 100, 199, 'Copier & Print Leasing'),
  (24300, 200, 299, 'Stationery & Learning Materials'),
  (24350, 100, 199, 'Back-Office Software'),
  (24350, 200, 299, 'Software Development'),
  (24350, 300, 399, 'Other Software Subscriptions'),
  (24400, 100, 199, 'Accounting & Audit'),
  (24400, 200, 299, 'Professional Services — General'),
  (24450, 100, 199, 'Banking'),
  (24450, 500, 599, 'Insurance'),
  (24500, 100, 199, 'Statutory Levies & Contributions'),
  (24500, 200, 299, 'IRAS Taxes'),
  (24550, 100, 199, 'Marketing Collateral, Printing & Signage'),
  (24550, 200, 299, 'Institutions'),
  (24600, 100, 199, 'Medical & Health'),
  (24600, 200, 299, 'Pantry & Catering'),
  (24600, 500, 599, 'Staff Welfare & Gifts'),
  (24700, 100, 199, 'General Retailers'),
  (24750, 100, 199, 'Other Suppliers'),
  (24998, 100, 199, 'Student Refunds'),
  (24999, 100, 199, 'Employee Reimbursements')
on conflict (group_code, code_start) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 111, 'SIM CHEE HONG', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 110
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 112, 'DIVEENA HOLDINGS', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 110
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 121, 'CORWIN HOLDING', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 120
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 122, 'TEKKA PLACE', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 120
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 131, 'MAYFIELD INVESTMENT', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 130
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 132, 'SUPER BOWL JURONG', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 130
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 133, 'GOLDEN BAY REALTY', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 130
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 134, 'MCST - 644 - ORCHARD TOWERS', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 130
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 141, 'MCST - 3835 - MEZZO', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 140
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24100, 151, 'MCST - 3372 - RAINTREE', null
from public.supplier_subgroups sg where sg.group_code = 24100 and sg.code_start = 150
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 101, 'SP DIGITAL', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 102, 'SP SERVICES', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 103, 'SP SERVICES (OT BASEMENT)', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 104, 'SP SERVICES (OT LEVEL 8)', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 105, 'SP SERVICES (OT LEVEL 24)', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 150, 'SENOKO ENERGY', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 201, 'SINGTEL', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 202, 'M1 LIMITED', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 203, 'STARHUB', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 301, 'SCDF', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 302, 'J&S SERVICES FIRE', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 303, 'FIRE MECHANICAL ENGINEERING', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 304, 'LKW CONSULTANCY', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 401, 'MN ENGINEERING', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 400
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 402, 'PAK TECHNOLOGIES', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 400
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 403, 'HOSIN TRADING', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 400
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 404, 'XING FLOORS', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 400
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 501, 'SPJ HELPING HANDS', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 502, 'REFINED SHINE & HYGIENE', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 503, 'PRISTINE CLEANING', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 504, 'RENTOKILL', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 601, '1 SIGN', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 600
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 602, 'LIM SIGN', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 600
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24150, 603, 'ART SIGN INTERNATIONAL', null
from public.supplier_subgroups sg where sg.group_code = 24150 and sg.code_start = 600
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24200, 101, 'ASSA ABLOY', null
from public.supplier_subgroups sg where sg.group_code = 24200 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24200, 102, 'BM OFFICE SUPPLIES', null
from public.supplier_subgroups sg where sg.group_code = 24200 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24200, 103, 'C&B FURNITURE TRADING', null
from public.supplier_subgroups sg where sg.group_code = 24200 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24200, 104, 'UMD LIFE', null
from public.supplier_subgroups sg where sg.group_code = 24200 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24200, 105, 'TIONG HIN LIGHT FURNITURE INDUSTRIES', null
from public.supplier_subgroups sg where sg.group_code = 24200 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24200, 106, 'IKANO', null
from public.supplier_subgroups sg where sg.group_code = 24200 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24200, 107, 'YOKE OFFICE EQUIPMENT', null
from public.supplier_subgroups sg where sg.group_code = 24200 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 101, 'SIM LIM SQUARE', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 102, 'BIZGRAM ASIA', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 103, 'GLOBAL CYBERMIND TECHNOLOGIES', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 104, 'GM ELECTRONICS', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 105, 'SINSENG COMPONENTS', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 106, 'SUMERA COMPUTERS', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 107, 'TAI HE ELECTRONICS', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 108, 'WORLDWIDE COMPUTER SERVICES', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 201, 'GOH SIN HUAT ELECTRICAL', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 301, '3F HARDWARE', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 302, 'CRESCENT MOBILES', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 303, 'DAVID WATCH', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 304, 'HENG WAH WATCH & PEN', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 305, 'ELUSH (T3)', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 306, 'ENG GUAN & CO', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 307, 'HAN SIANG HARDWARE', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 308, 'LG DEPARTMENTAL STORE', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 309, 'POWER 8', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24250, 310, 'ZENER DIY', null
from public.supplier_subgroups sg where sg.group_code = 24250 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 101, 'TTS COPIER INTERNATIONAL', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 102, 'GC LEASE SINGAPORE', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 201, 'AFBV', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 202, 'BOOK POINT', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 203, 'EDUCATIONAL PUBLISHING HOUSE', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 204, 'KINOKUNIYA', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 205, 'CITIMAX STATIONERY TRADING', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 206, 'LYRECO', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 207, 'CMYZ DESIGN & PRINTS', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 208, 'HOME & OFFICE STATIONARY', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 209, 'INK BOW', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24300, 210, 'POPULAR', null
from public.supplier_subgroups sg where sg.group_code = 24300 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 101, 'QUICKBOOKS', null
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 102, 'ABACUS TECHNOLOGIES', null
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 103, 'INFO-TECH', null
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 104, 'SUPREME HR', null
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 201, 'RAYMOND SOFTWARE', null
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 202, 'XCELARE SOFTWARE SOLUTIONS', null
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 301, 'CANVA', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 302, 'WHATSAPP BUSINESS / META', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24350, 303, 'QUICK REPLIES / MESSAGING TOOL', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24350 and sg.code_start = 300
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24400, 101, 'SILVER STAR CONSULTANCY', null
from public.supplier_subgroups sg where sg.group_code = 24400 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24400, 102, 'BLISS INFOTECH', null
from public.supplier_subgroups sg where sg.group_code = 24400 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24400, 201, 'SPACING CONSULTANCY', null
from public.supplier_subgroups sg where sg.group_code = 24400 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24450, 101, 'DBS 003', null
from public.supplier_subgroups sg where sg.group_code = 24450 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24450, 102, 'OCBC 650', null
from public.supplier_subgroups sg where sg.group_code = 24450 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24450, 103, 'OCBC 687', null
from public.supplier_subgroups sg where sg.group_code = 24450 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24450, 501, 'HSBC INSURANCE', null
from public.supplier_subgroups sg where sg.group_code = 24450 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24450, 502, 'CHUBB INSURANCE', null
from public.supplier_subgroups sg where sg.group_code = 24450 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24450, 503, 'AWG INSURANCE', null
from public.supplier_subgroups sg where sg.group_code = 24450 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 101, 'CPF', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 102, 'GST', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 103, 'WORK PERMIT LEVY', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 104, 'SKILLS DEVELOPMENT LEVY (SDL)', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 105, 'MOM PASS ISSUANCE', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 201, 'IRAS (INCOME TAX)', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 202, 'IRAS (PROPERTY TAX)', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 203, 'IRAS (CORPORATE TAX)', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24500, 204, 'IRAS (STAMP DUTY)', null
from public.supplier_subgroups sg where sg.group_code = 24500 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24550, 101, 'HI-TECH IMAGES', null
from public.supplier_subgroups sg where sg.group_code = 24550 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24550, 102, 'SIGNCRAFT EXPRESS', null
from public.supplier_subgroups sg where sg.group_code = 24550 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24550, 103, 'PRINTING & PROMOTIONAL VENDORS', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24550 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24550, 201, 'NANYANG TECHNOLOGICAL UNIVERSITY (NTU)', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24550 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24550, 202, 'NATIONAL UNIVERSITY OF SINGAPORE (NUS)', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24550 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24550, 203, 'SINGAPORE MANAGEMENT UNIVERSITY (SMU)', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24550 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24550, 204, 'OTHER SCHOOLS & EDUCATION CENTRES', 'Reserved from the draft hierarchy; no QuickBooks history yet.'
from public.supplier_subgroups sg where sg.group_code = 24550 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 101, 'APOLLO MEDICAL', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 201, 'NTUC FAIR PRICE', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 202, 'COLD STORAGE', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 203, 'TECK SANG', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 204, 'SKP', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 205, 'KAILASH PARBAT', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 200
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 501, 'Staff Welfare (Cash)', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 502, 'Staff Welfare (Gold)', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24600, 503, 'AKSHAYA JEWELLERY', null
from public.supplier_subgroups sg where sg.group_code = 24600 and sg.code_start = 500
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 101, 'ABC BARGAIN CENTRE', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 102, 'AMAZON', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 103, 'COURTS', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 104, 'MUSTAFA', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 105, 'HANIFFA', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 106, 'JOTHI STORE', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 107, 'MAYUR TRADING', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 108, 'RAM INFOTECH', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 109, 'SHOPEE', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24700, 110, 'SMI PLASTIC', null
from public.supplier_subgroups sg where sg.group_code = 24700 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24750, 101, 'STUDY BUDDY', null
from public.supplier_subgroups sg where sg.group_code = 24750 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24998, 101, 'STUDENT REFUND', null
from public.supplier_subgroups sg where sg.group_code = 24998 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.suppliers (subgroup_id, group_code, sub_code, name, notes)
select sg.id, 24999, 101, 'EMPLOYEE REIMBURSEMENT', null
from public.supplier_subgroups sg where sg.group_code = 24999 and sg.code_start = 100
on conflict (group_code, sub_code) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ABC BARGAI', '24700-10' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ACCOUNTING & AUDIT FEES-BLISS INFOTECH', '24400-12' from public.suppliers s
where s.group_code = 24400 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ACCOUNTING & AUDIT FEES-SILVER STAR CONSULTANCY PTE LTD', '24400-10' from public.suppliers s
where s.group_code = 24400 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'AMAZON', '24700-11' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'APOLLO MEDICAL', '24600-10' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'BANK TXN CHARGES-DBS 003', '24450-10' from public.suppliers s
where s.group_code = 24450 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'BANK TXN CHARGES-OCBC 650', '24450-11' from public.suppliers s
where s.group_code = 24450 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'BANK TXN CHARGES-OCBC 687', '24450-12' from public.suppliers s
where s.group_code = 24450 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'BM OFFICE FURNITURES', '24200-11' from public.suppliers s
where s.group_code = 24200 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'BOOKS-BOOK POINT', '24300-21' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'BOOKS-EDUCATIONAL PUBLISHING HOUSE PTE LTD', '24300-22' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 203
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'BOOKS-KINOKUNIYA', '24300-23' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 204
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'CB FURNITURE', '24200-12' from public.suppliers s
where s.group_code = 24200 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'CHAIRS AND TABLES - UMD LIFE PTE LTD', '24200-13' from public.suppliers s
where s.group_code = 24200 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'CLEANING-OT-SPJ HELPING', '24150-50' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 501
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'COMPTROLLER OF INCOME TAX - 200712084Z', '24500-20' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 201
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'CORPORATE TAX', '24500-22' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 203
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'CORWIN HOLDING', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'DEPOSIT ORCHARD TOWER - MAYFIELD INVESTMENT - #B1-01/41', '24100-30' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 131
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'DEPOSIT ORCHARD TOWER - SUPER BOWL JURONG - #B1-01/40', '24100-31' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 132
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'DEPOSIT ORCHARD TOWERS- GOLDEN BAY REALITY - LEVEL 8', '24100-32' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 133
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'DIVESH GRAB BILL', '24999-10' from public.suppliers s
where s.group_code = 24999 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'DIVESH M1 BILL', '24999-10' from public.suppliers s
where s.group_code = 24999 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ELECTRONICS & GADGETS-ART SIGN INTERNATIONAL PTE LTD', '24150-62' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 603
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ELECTRONICS & GADGETS-COURTS', '24700-12' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ELECTRONICS & GADGETS-GLOBAL CYBER COMPUTERS PTE LTD', '24250-12' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ELECTRONICS & GADGETS-HENG WAH SHOP', '24250-33' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 304
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ELECTRONICS & GADGETS-MUSTAFA', '24700-13' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ELECTRONICS & GADGETS-SIM LIM SQUARE', '24250-10' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'Employee Reimbursement Claims', '24999-10' from public.suppliers s
where s.group_code = 24999 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'FURNITURE & FITTINGS-GOH SIN HUAT ELECTRICAL PTE LTD', '24250-36' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 201
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'FURNITURES & FITTINGS - TIONG HIN LIGHT FURNITURE INDUSTRIES PTE. LTD.', '24200-14' from public.suppliers s
where s.group_code = 24200 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'GOVIND CLEANER', '24150-51' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 502
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'HI TECH', '24550-10' from public.suppliers s
where s.group_code = 24550 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'Hosin Trading', '24150-42' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 403
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'INSURANCE HOSP + GP - HSBC INSURANCE PTE LTD', '24450-50' from public.suppliers s
where s.group_code = 24450 and s.sub_code = 501
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'INSURANCE-IMMIGRATION BOND-AWG INSURANCE', '24450-53' from public.suppliers s
where s.group_code = 24450 and s.sub_code = 503
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'INSURANCE-PROPERTY & WICA -CHUBB INSURANCE PTE LTD', '24450-52' from public.suppliers s
where s.group_code = 24450 and s.sub_code = 502
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'INSURANCE-STAFF HOSP+GP-HSBC INSURANCE PTE LTD', '24450-51' from public.suppliers s
where s.group_code = 24450 and s.sub_code = 501
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'Lyreco', '24300-25' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 206
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'MCST ORCHARD TOWERS-664', '24100-33' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 134
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'MN ENGINEERING', '24150-40' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 401
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'MR.KHAN', '24150-41' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 402
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - 1 SIGN', '24150-60' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 601
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - 3F HARDWARE', '24250-30' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 301
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - AFBV', '24300-20' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 201
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - AKSHAYA JEWELLERY', '24600-52' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 503
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - BIZGRAM AS', '24250-11' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - CITIMAX', '24300-24' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 205
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - COLD STORAGE', '24600-21' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - COURTS', '24700-12' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - CRESCENT MOBILES', '24250-31' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 302
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - DAVID WATCH', '24250-32' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 303
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - ELUSH (T3)', '24250-34' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 305
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - ENG GUAN &', '24250-35' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 306
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - GLOBAL CYB', '24250-12' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - GM ELECTRONICS', '24250-13' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - HAN SIANG', '24250-37' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 307
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - HANIFFA', '24700-14' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - HARDWARE', '24250-30' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 301
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - IKANO', '24200-15' from public.suppliers s
where s.group_code = 24200 and s.sub_code = 106
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - JOTHI STORE', '24700-15' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 106
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - LG DEPARTMENTAL STORE', '24250-38' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 308
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - LIM SIGN', '24150-61' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 602
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - MAYUR TRADING', '24700-16' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 107
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - MUSTAFA', '24700-13' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - POWER 8', '24250-39' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 309
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - SIGNCRAF', '24550-11' from public.suppliers s
where s.group_code = 24550 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - SINSENG CO', '24250-14' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - SKP', '24600-23' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 204
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - SKP PTE LTD', '24600-23' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 204
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - SMI PLASTIC', '24700-19' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 110
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - SP DIGITAL', '24150-14' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - SUMERA COM', '24250-15' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 106
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - TAI HE ELE', '24250-16' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 107
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - WORLDWIDE', '24250-17' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 108
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'NETS PURCHASE - ZENER D', '24250-41' from public.suppliers s
where s.group_code = 24250 and s.sub_code = 310
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ORCHARD MAINTENANCE', '24100-33' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 134
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ORCHARD RENOVATION - HI TECH IMAGES', '24550-10' from public.suppliers s
where s.group_code = 24550 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ORCHARD RENOVATION - LKW CONSULTANCY', '24150-33' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 304
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ORCHARD RENOVATION-JS SERVICES FIRE', '24150-31' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 302
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'ORCHARD TOWER -SIGNBOARD DEPOSIT', '24100-33' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 134
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT RENO-FIRE MECHANICAL ENGG PTE LTD', '24150-32' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 303
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT RENOVATION - XING FLOOR', '24150-43' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 404
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-24-05/06-SP SERVICES DEPOSIT', '24150-13' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-24-07-SP SERVICES DEPOSIT', '24150-13' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-24-09/10 -SP SERVICES DEPOSIT', '24150-13' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SIGNBOARD RENTAL', '24100-33' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 134
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-03', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-04', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-06', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-07', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-08', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-09', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-10', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-11', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-12', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-13', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -08-14', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -24-05/06', '24150-13' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -24-07', '24150-13' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -24-09/10', '24150-13' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES -B140', '24150-11' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES 08-05', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08-06', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08/07', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08/08', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08/10', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08/11', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08/12', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08/13', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'OT-SP SERVICES DEPOSIT-08/14', '24150-12' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PAK  TECHNOLOKHAN', '24150-41' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 402
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PAK-KHAN', '24150-41' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 402
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PHOTOCOPY - CMYZ DESIGN & PRINTS', '24300-26' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 207
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PHOTOCOPY - GC LEASE SINGAPORE', '24300-11' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PHOTOCOPY - TTS COPIER INTERNATIONAL', '24300-10' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PRISTINE CLEANING', '24150-52' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 503
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY MAINTAINANCE(COMMISSION)-MEZZO-01-05', '24100-40' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 141
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY MAINTAINANCE- MEZZO #01-05', '24100-40' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 141
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY MAINTAINANCE-MEZZO #01-04', '24100-40' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 141
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY MAINTAINANCE-MEZZO #01-07', '24100-40' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 141
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY MAINTAINANCE-MEZZO #01-09', '24100-40' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 141
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY MAINTAINANCE-RAINTREE #01-31', '24100-41' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 151
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX  01-02', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX  01-04', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX -MZO01-05', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX -MZO01-07', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX 01-05', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX 01-07', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX 01-09', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PROPERTY TAX 01-31', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PTAX -01-04', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'PTAX-01-09', '24500-21' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'QuickBooks', '24350-xx' from public.suppliers s
where s.group_code = 24350 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RAM INFOTECH', '24700-17' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 108
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RAYMOND -( SOFTWARE)', '24350-10' from public.suppliers s
where s.group_code = 24350 and s.sub_code = 201
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'REFUND', '24998-xx' from public.suppliers s
where s.group_code = 24998 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT - TEKKA DEP-1-5,11,13/14', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT ORCHARD TOWER - MAYFIELD INVESTMENT - #B1-01/41', '24100-30' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 131
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT ORCHARD TOWER - SUPER BOWL JURONG - #B1-01/40', '24100-31' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 132
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT ORCHARD TOWERS- GOLDEN BAY REALITY - LEVEL 24 (07/25-03)', '24100-32' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 133
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT ORCHARD TOWERS- GOLDEN BAY REALITY - LEVEL 25(05,06,09,10)', '24100-32' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 133
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT ORCHARD TOWERS- GOLDEN BAY REALITY - LEVEL 8', '24100-32' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 133
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT ORCHARD TOWERS- GOLDEN BAY REALITY - LEVEL 8 (06-14)', '24100-32' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 133
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT OUTWARD -01-51-01-59', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT OUTWARD-05-23 DIVEENA HOLDINGS PTE LTD', '24100-11' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 112
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENT SIM CHEE HONG', '24100-10' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 111
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'RENTOKILL INTIAL MAINTENANCES', '24150-70' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 504
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SCDF ORCHARD TOWER', '24150-30' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 301
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKA- 55-59', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKA-51-54', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO - 13/14', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO - B1-03/04', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO -B1- 11', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO -B1- 6-9', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO -B16-9', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO B1-01/02', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO-51-54', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SENOKO-B1-10', '24150-90' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 150
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SHOPEE', '24700-18' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 109
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SKILLS DEVLOPMENT (SDL)', '24500-13' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SMI PLASTI', '24700-19' from public.suppliers s
where s.group_code = 24700 and s.sub_code = 110
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SOFTWARE CHARGES-ABACUS TECHNOLOGIES PTE LTD', '24350-20' from public.suppliers s
where s.group_code = 24350 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SOFTWARE CHARGES-INFO-TECH SYSTEMS INTEGRATORS PTE LTD', '24350-21' from public.suppliers s
where s.group_code = 24350 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SOFTWARE CHARGES-XCELARE SOFTWARE SOLUTIONS', '24350-11' from public.suppliers s
where s.group_code = 24350 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SP WATER', '24150-10' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'SPACING CONSULTANCY', '24400-11' from public.suppliers s
where s.group_code = 24400 and s.sub_code = 201
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STAFF WELFARE - CASH', '24600-50' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 501
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STAFF WELFARE - GOLD', '24600-51' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 502
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STAFF WELFARE - KAILASH PARBAT', '24600-24' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 205
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STAFF WELFARE - NTUC FAIR PRICE', '24600-20' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 201
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATIONERY & PANTRY-COLD STORAGE', '24600-21' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATIONERY & PANTRY-HOME & OFFICE STATIONARY', '24300-27' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 208
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATIONERY & PANTRY-INK BOW PTE LTD', '24300-28' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 209
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATIONERY & PANTRY-LYRECO(SINGAPORE) PTE LTD.', '24300-25' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 206
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATIONERY & PANTRY-POPULAR BOOK COMPANY PTE LTD', '24300-29' from public.suppliers s
where s.group_code = 24300 and s.sub_code = 210
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATUTORY CONTRIBUTION-CPF', '24500-10' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATUTORY CONTRIBUTION-GST', '24500-11' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 102
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATUTORY CONTRIBUTION-LEVY', '24500-12' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 103
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATUTORY CONTRIBUTION-PASS ISSUANCE-MOM', '24500-14' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 105
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STATUTORY CONTRIBUTION-STAMP DUTY', '24500-23' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 204
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'STUDY BUDDY', '24750-xx' from public.suppliers s
where s.group_code = 24750 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'StarHub', '24150-xx' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 203
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'Supreme HR', '24350-22' from public.suppliers s
where s.group_code = 24350 and s.sub_code = 104
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TAX /STAMP -06/07', '24500-23' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 204
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TAX /STAMP -13/14', '24500-23' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 204
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TAX TEKKA-B1-3/4/5', '24500-23' from public.suppliers s
where s.group_code = 24500 and s.sub_code = 204
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TECK SANG', '24600-22' from public.suppliers s
where s.group_code = 24600 and s.sub_code = 203
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKA CENTER', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA MANAGEMENT', '24100-11' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 122
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENOVATION - ASSA ABLOY', '24200-10' from public.suppliers s
where s.group_code = 24200 and s.sub_code = 101
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENOVATION - PAK TECHNOLOGIES', '24150-41' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 402
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD - B1-03/4/5D', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD - B1-11', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD -01-51-01-59', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD -06/07', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD -B1-06-10', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD -B106-10', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD B1- 01-02', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD B1- 13/14', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TEKKA RENT OUTWARD B1-1-5,11,13,14', '24100-20' from public.suppliers s
where s.group_code = 24100 and s.sub_code = 121
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TELECOMMUNICATIONS-INTERNET - SINGTEL', '24150-20' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 201
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'TELECOMMUNICATIONS-MOBILE-M1 LIMITED', '24150-21' from public.suppliers s
where s.group_code = 24150 and s.sub_code = 202
on conflict (alias_key) do nothing;

insert into public.supplier_aliases (supplier_id, alias, old_code)
select s.id, 'YOKE OFFICE EQUIPMENTS', '24250-40' from public.suppliers s
where s.group_code = 24200 and s.sub_code = 107
on conflict (alias_key) do nothing;

-- The "(Off-the-Shelf)" qualifier was drafting shorthand, not a header.
-- Kept here as an update too, so a database seeded before the rename
-- picks it up on a re-run.
update public.supplier_subgroups set name = 'Back-Office Software'
where group_code = 24350 and code_start = 100
  and name = 'Back-Office Software (Off-the-Shelf)';

-- Dropped "Books," from the stationery sub-group. Applied as an update too,
-- so a database seeded before the rename picks it up on a re-run.
update public.supplier_subgroups set name = 'Stationery & Learning Materials'
where group_code = 24300 and code_start = 200
  and name = 'Books, Stationery & Learning Materials';

-- Renamed the 24350 build sub-group to Software Development. Applied as an
-- update too, so a database seeded before the rename picks it up on a re-run.
update public.supplier_subgroups set name = 'Software Development'
where group_code = 24350 and code_start = 200
  and name = 'Development Platforms & Developers';

-- Shortened the 24450 banking sub-group to just Banking. Applied as an update
-- too, so a database seeded before the rename picks it up on a re-run.
update public.supplier_subgroups set name = 'Banking'
where group_code = 24450 and code_start = 100
  and name = 'Banking & Transaction Charges';
