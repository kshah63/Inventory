-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0017 — Tick your own request once you've collected it
--
--  0014 gave the requester the collected tick on an *order*. A request that
--  procurement buys in gets the same "Ready to collect" wording and the same
--  final state — the requester's view calls 'fulfilled' "Collected" — but
--  there was no way for them to say so. Only procurement could close it,
--  which is the thing 0014 set out to fix in the first place.
--
--  collect_request() is collect_order()'s twin: the person picking it up
--  ticks it, procurement can tick it for someone who forgets, and it only
--  works from 'ready', since collecting something that isn't ready yet is
--  not a thing that can have happened.
-- Run once, after 0016. Safe on a live database. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- When it was actually picked up, alongside received_at (when it reached us).
alter table public.requests add column if not exists collected_at timestamptz;

create or replace function public.collect_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_request public.requests;
begin
  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request not found.';
  end if;
  -- Yours to tick; procurement can tick it for somebody who forgets.
  if v_request.requested_by <> auth.uid() and not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if v_request.status <> 'ready' then
    raise exception 'Only a request that is ready to collect can be marked collected.';
  end if;

  update public.requests
  set status = 'fulfilled', collected_at = now(), updated_at = now()
  where id = p_request_id;
end;
$$;

grant execute on function public.collect_request(uuid) to authenticated;
