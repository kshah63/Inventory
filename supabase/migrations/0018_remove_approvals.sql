-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0018 — The approval flow goes, because it was already gone
--
--  items.requires_approval was only ever enforced by the kiosk checkout, and
--  0008 removed that. Since then the only function that so much as mentioned
--  the column was import_catalog, which copies it in from a CSV. Nothing
--  gated anything: a "Requires approval" item was packed like any other,
--  while the catalogue still showed the requester an Approval badge
--  promising a review that could not happen.
--
--  Nothing could raise a pending checkout either — request_approval() was a
--  kiosk function and went with the rest of them — so the Approvals screen
--  could only ever show rows from before 0008.
--
--  This removes the dead ends. As elsewhere, the table and the column stay:
--  pending_checkouts holds whatever history there is, and dropping a column
--  the deployed app still selects is what logged everyone out in 0008.
-- Run once, after 0017. Safe on a live database. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. The decision function has nothing left to decide on.
drop function if exists public.decide_pending_checkout(uuid, boolean, text);

-- 2. Stop counting approvals nobody can create. Everything else on the
--    dashboard is unchanged.
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
    'open_requests', (select count(*) from public.requests
                      where status in ('open','acknowledged')),
    'ordered_requests', (select count(*) from public.requests
                         where status in ('ordered','received')),
    'requests_to_hand_over', (select count(*) from public.requests
                              where status = 'ready'),
    'pending_orders', (select count(*) from public.orders where status = 'pending'),
    'ready_orders', (select count(*) from public.orders where status = 'ready'),
    'reset_requests', (select count(*) from public.password_reset_requests
                       where status = 'open'),
    'checkouts_today', (select coalesce(sum(-qty_delta), 0) from public.transactions
                        where type = 'checkout' and created_at >= date_trunc('day', now())),
    'top_movers_week', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select i.name, sum(-t.qty_delta)::int as qty
      from public.transactions t
      join public.items i on i.id = t.item_id
      where t.type = 'checkout' and t.created_at > now() - interval '7 days'
      group by i.name
      order by 2 desc
      limit 5
    ) x)
  ) into v_result;
  return v_result;
end;
$$;

-- 3. Every "Requires approval" flag was a promise nothing kept. Clearing it
--    means the column reads as what it now is: unused.
update public.items set requires_approval = false where requires_approval;
