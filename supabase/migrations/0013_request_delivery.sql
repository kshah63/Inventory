-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0013 — "Where has my stuff got to?"
--
--  Requests went Ordered → Fulfilled with nothing in between, so procurement
--  had nowhere to record "it has arrived but isn't packed yet", and the
--  requester had nothing to tell them when to expect it.
--
--   • received  — a new stage between ordered and ready. Deliberately shown
--     to the requester as "on order": stock arriving is not the same as it
--     being ready for them, and a day or two of packing sits in between.
--   • ready     — the moment the requester is told to come and collect.
--   • expected_date — what procurement tells them instead, so the hidden
--     stage doesn't leave them in the dark.
-- Run once, after 0012. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.requests add column if not exists expected_date date;
alter table public.requests add column if not exists received_at timestamptz;

alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status in ('open','acknowledged','ordered','received','ready','fulfilled','rejected'));

-- Procurement moves a request along, optionally setting the date the
-- requester will see. Stamps received_at the first time it lands there.
create or replace function public.set_request_progress(
  p_request_id uuid,
  p_status text default null,
  p_expected_date date default null,
  p_clear_expected boolean default false,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_request public.requests;
  v_status text;
begin
  perform public._require_admin();

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request not found.';
  end if;

  v_status := coalesce(p_status, v_request.status);
  if v_status not in ('open','acknowledged','ordered','received','ready','fulfilled','rejected') then
    raise exception 'Invalid status.';
  end if;

  update public.requests
  set status = v_status,
      received_at = case
        when v_status = 'received' and received_at is null then now()
        else received_at
      end,
      expected_date = case
        when p_clear_expected then null
        else coalesce(p_expected_date, expected_date)
      end,
      admin_note = coalesce(nullif(trim(coalesce(p_admin_note, '')), ''), admin_note)
  where id = p_request_id;

  return jsonb_build_object(
    'status', v_status,
    'item_label', coalesce(v_request.free_text_item,
                           (select name from public.items where id = v_request.item_id),
                           'item'),
    'qty', v_request.qty,
    'requester_phone', (select phone from public.users where id = v_request.requested_by),
    -- Only tell the requester when something changed for them: arriving in
    -- the store room is our business, being ready to collect is theirs.
    'notify', v_status in ('ready','rejected','fulfilled')
               and v_status is distinct from v_request.status
  );
end;
$$;

grant execute on function public.set_request_progress(uuid, text, date, boolean, text)
  to authenticated;

-- The dashboard counts everything still in flight, including the new stage.
create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public, extensions
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
    'ordered_requests', (select count(*) from public.requests where status in ('ordered','received')),
    'requests_to_hand_over', (select count(*) from public.requests where status = 'ready'),
    'pending_orders', (select count(*) from public.orders where status = 'pending'),
    'ready_orders', (select count(*) from public.orders where status = 'ready'),
    'pending_approvals', (select count(*) from public.pending_checkouts where status = 'pending'),
    'reset_requests', (select count(*) from public.password_reset_requests where status = 'open'),
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
