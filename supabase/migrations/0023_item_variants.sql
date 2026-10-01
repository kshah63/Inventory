-- 0023_item_variants.sql
-- Items that come in variants (a highlighter in several colours, a gel pen in
-- a size AND a colour) were separate rows, which made the catalogue long.
-- An item_group ties those rows together for display and selection: you pick
-- the product, then the variant, then the quantity. Each variant stays its own
-- stockable item — so stock levels, orders, and the ledger are untouched; the
-- group is only a lens over them.
--
-- A group has one or two attributes (attr1 always, attr2 optional). A variant
-- item carries its value for each. Safe on a live database; re-runnable.

create table if not exists public.item_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category_id uuid not null references public.categories(id),
  -- The thing you choose: "Colour", "Size", "Length". attr2 is null for a
  -- single-attribute group.
  attr1_label text not null,
  attr2_label text,
  photo_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.items add column if not exists group_id uuid references public.item_groups(id);
alter table public.items add column if not exists attr1_value text;
alter table public.items add column if not exists attr2_value text;

-- A grouped item is a variant, so it must name at least its first attribute.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'items_variant_attr_check') then
    alter table public.items add constraint items_variant_attr_check
      check (group_id is null or attr1_value is not null);
  end if;
end $$;

-- No two variants of a group share the same combination. coalesce folds the
-- optional second attribute so single-attribute groups compare cleanly.
create unique index if not exists items_group_variant_uidx
  on public.items (group_id, attr1_value, coalesce(attr2_value, ''))
  where group_id is not null;
create index if not exists items_group_idx on public.items (group_id);

-- ── RLS: groups are display metadata — any signed-in user may read them (a
-- hidden admin-only variant is still hidden at the item level), admins write ──
alter table public.item_groups enable row level security;

drop policy if exists item_groups_read on public.item_groups;
create policy item_groups_read on public.item_groups for select to authenticated using (true);

drop policy if exists item_groups_admin_insert on public.item_groups;
create policy item_groups_admin_insert on public.item_groups for insert to authenticated
  with check (public.is_admin());

drop policy if exists item_groups_admin_update on public.item_groups;
create policy item_groups_admin_update on public.item_groups for update to authenticated
  using (public.is_admin());

drop policy if exists item_groups_admin_delete on public.item_groups;
create policy item_groups_admin_delete on public.item_groups for delete to authenticated
  using (public.is_admin());

-- ── Create / rename a group ────────────────────────────────────────────────
create or replace function public.save_item_group(
  p_id uuid, p_name text, p_category_id uuid,
  p_attr1 text, p_attr2 text, p_is_active boolean
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform public._require_admin();
  if nullif(trim(coalesce(p_name,'')), '') is null then
    raise exception 'A name is required.';
  end if;
  if nullif(trim(coalesce(p_attr1,'')), '') is null then
    raise exception 'At least one attribute (for example Colour) is required.';
  end if;
  if p_id is null then
    insert into public.item_groups (name, category_id, attr1_label, attr2_label, is_active)
    values (trim(p_name), p_category_id, trim(p_attr1),
            nullif(trim(coalesce(p_attr2,'')), ''), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.item_groups
    set name = trim(p_name), category_id = p_category_id,
        attr1_label = trim(p_attr1),
        attr2_label = nullif(trim(coalesce(p_attr2,'')), ''),
        is_active = coalesce(p_is_active, true)
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Group not found.'; end if;
  end if;
  return v_id;
end;
$$;
grant execute on function public.save_item_group(uuid, text, uuid, text, text, boolean) to authenticated;

-- ── Fold existing items into a group (the catalogue clean-up) ──────────────
-- p_assignments: [{ "item_id": uuid, "attr1_value": text, "attr2_value": text? }]
create or replace function public.assign_items_to_group(
  p_group_id uuid, p_assignments jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_row jsonb;
  v_attr2_label text;
  v_a1 text;
  v_count int := 0;
begin
  perform public._require_admin();
  select attr2_label into v_attr2_label from public.item_groups where id = p_group_id;
  if not found then raise exception 'Group not found.'; end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    v_a1 := nullif(trim(coalesce(v_row->>'attr1_value','')), '');
    if v_a1 is null then
      raise exception 'Every item needs a value for the first attribute.';
    end if;
    update public.items
    set group_id = p_group_id,
        attr1_value = v_a1,
        attr2_value = case when v_attr2_label is null
                          then null
                          else nullif(trim(coalesce(v_row->>'attr2_value','')), '') end
    where id = (v_row->>'item_id')::uuid;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.assign_items_to_group(uuid, jsonb) to authenticated;

-- ── Take an item back out of its group ─────────────────────────────────────
create or replace function public.ungroup_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  update public.items
  set group_id = null, attr1_value = null, attr2_value = null
  where id = p_item_id;
end;
$$;
grant execute on function public.ungroup_item(uuid) to authenticated;
