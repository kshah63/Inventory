\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function public.t_assert(cond boolean, msg text) returns void
language plpgsql as $fn$
begin
  if cond is distinct from true then
    raise exception 'ASSERT FAILED: %', msg;
  end if;
  raise notice 'PASS: %', msg;
end $fn$;
set client_min_messages = notice;

-- ═══ Actors ═══
-- First auth user → auto super admin via trigger
insert into auth.users (id, email, raw_user_meta_data)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'kartik@mv.sg', '{"full_name":"Kartik"}');
select public.t_assert(
  (select role from public.users where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'super_admin',
  'first auth user bootstraps as super_admin');

-- Second auth user → staff by default
insert into auth.users (id, email, raw_user_meta_data)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'priya@mv.sg', '{"full_name":"Priya"}');
select public.t_assert(
  (select role from public.users where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 'staff',
  'second auth user defaults to staff');

-- Kiosk device pinned to Level 8
insert into public.users (id, full_name, role, kiosk_location_id)
select 'bbbbbbbb-0000-0000-0000-000000000001', 'Kiosk — Level 8', 'kiosk', id
from public.locations where name = 'Level 8';

-- Super admin sets Priya's PIN
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.set_user_pin('aaaaaaaa-0000-0000-0000-000000000002', '4821');

-- ═══ PIN rate limiting (the critical fix): failures must PERSIST ═══
set test.uid = 'bbbbbbbb-0000-0000-0000-000000000001';
select public.t_assert(
  (public.kiosk_start_session('aaaaaaaa-0000-0000-0000-000000000002', '0000')->>'error') = 'PIN_INVALID',
  'wrong PIN returns PIN_INVALID');
select public.kiosk_start_session('aaaaaaaa-0000-0000-0000-000000000002', '0000');
select public.kiosk_start_session('aaaaaaaa-0000-0000-0000-000000000002', '0000');
select public.kiosk_start_session('aaaaaaaa-0000-0000-0000-000000000002', '0000');
select public.t_assert(
  (select pin_failed_attempts from public.users where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 4,
  'failed attempts counter persists (=4 after 4 wrong PINs)');
select public.t_assert(
  (public.kiosk_start_session('aaaaaaaa-0000-0000-0000-000000000002', '0000')->>'error') = 'PIN_LOCKED:60',
  '5th failure locks the PIN for 60s');
select public.t_assert(
  (public.kiosk_start_session('aaaaaaaa-0000-0000-0000-000000000002', '4821')->>'error') like 'PIN_LOCKED:%',
  'even the correct PIN is rejected while locked');
select public.t_assert(
  (select count(*) from public.pin_attempts where success = false) = 5,
  'all 5 failed attempts were audited');

-- Unlock (simulate 60s passing) and sign in
update public.users set pin_locked_until = now() - interval '1 second'
where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select (public.kiosk_start_session('aaaaaaaa-0000-0000-0000-000000000002', '4821')->>'token')::uuid as tok \gset
select public.t_assert(:'tok' is not null, 'correct PIN opens a session');

-- ═══ Checkout: stock math, ledger, caps, duplicate-line merge ═══
select id as pen_id from public.items where sku = 'STA-PEN-BLU' \gset
select id as l8_id from public.locations where name = 'Level 8' \gset
select id as marker_id from public.items where sku = 'STA-MRK-WBL' \gset

-- baseline: pen L8 = 50, marker L8 = 24 (cap 4)
select public.kiosk_checkout(:'tok', jsonb_build_array(jsonb_build_object('item_id', :'pen_id'::uuid, 'qty', 2)));
select public.t_assert(
  (select qty_on_hand from public.stock_levels where item_id = :'pen_id' and location_id = :'l8_id') = 48,
  'checkout decrements stock 50→48');
select public.t_assert(
  (select count(*) from public.transactions where item_id = :'pen_id' and type = 'checkout'
    and qty_delta = -2 and user_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 1,
  'ledger row written with correct user and qty');

-- max_per_checkout: marker capped at 4 — single line over cap
do $x$ begin
  perform public.kiosk_checkout(
    (select token from public.kiosk_sessions order by created_at desc limit 1),
    (select jsonb_build_array(jsonb_build_object('item_id', id, 'qty', 5)) from public.items where sku='STA-MRK-WBL'));
  raise exception 'ASSERT FAILED: over-cap checkout should have been rejected';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: max_per_checkout enforced (%)', sqlerrm;
end $x$;

-- duplicate lines summing over cap (3+3=6 > 4) must be rejected too
do $x$ begin
  perform public.kiosk_checkout(
    (select token from public.kiosk_sessions order by created_at desc limit 1),
    (select jsonb_build_array(
       jsonb_build_object('item_id', id, 'qty', 3),
       jsonb_build_object('item_id', id, 'qty', 3)) from public.items where sku='STA-MRK-WBL'));
  raise exception 'ASSERT FAILED: split-line cap bypass should have been rejected';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: duplicate lines merged, cap applies to total (%)', sqlerrm;
end $x$;

-- overdraw: more than available must fail atomically (A3 paper L8 = 3)
do $x$ begin
  perform public.kiosk_checkout(
    (select token from public.kiosk_sessions order by created_at desc limit 1),
    (select jsonb_build_array(jsonb_build_object('item_id', id, 'qty', 4)) from public.items where sku='PAN-TEA-BAG'));
  raise exception 'ASSERT FAILED: overdraw should have been rejected';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: overdraw rejected with friendly message (%)', sqlerrm;
end $x$;
select public.t_assert(
  (select qty_on_hand from public.stock_levels sl join public.items i on i.id=sl.item_id
    where i.sku='PAN-TEA-BAG' and sl.location_id = :'l8_id') = 3,
  'failed checkout leaves stock untouched');

-- hit_zero reporting: drain A3 paper (3 left) and check alert payload
select public.kiosk_checkout(:'tok',
  (select jsonb_build_array(jsonb_build_object('item_id', id, 'qty', 3)) from public.items where sku='PAN-TEA-BAG')) as r \gset
select public.t_assert(
  (:'r'::jsonb->'hit_zero'->0->>'name') = 'Tea bags (box of 100)'
    and (:'r'::jsonb->'hit_zero'->0->'elsewhere'->0->>'qty')::int = 2,
  'hit-zero alert payload includes other-room stock');

-- approval-required item cannot be checked out directly
do $x$ begin
  perform public.kiosk_checkout(
    (select token from public.kiosk_sessions order by created_at desc limit 1),
    (select jsonb_build_array(jsonb_build_object('item_id', id, 'qty', 1)) from public.items where sku='IT-TNR-HP26'));
  raise exception 'ASSERT FAILED: approval item direct checkout should be rejected';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: approval-required item blocked from direct checkout (%)', sqlerrm;
end $x$;

-- ═══ Approval flow ═══
select public.kiosk_request_approval(:'tok',
  (select id from public.items where sku='IT-TNR-HP26'), 1) as apr \gset
select public.t_assert(
  (select count(*) from public.pending_checkouts where status='pending') = 1,
  'approval request creates pending row');

set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.decide_pending_checkout(
  (select id from public.pending_checkouts where status='pending'), true, 'ok') as dec \gset
select public.t_assert((:'dec'::jsonb->>'status') = 'approved', 'approval decision returns approved');
select public.t_assert(
  (select qty_on_hand from public.stock_levels sl join public.items i on i.id=sl.item_id
    where i.sku='IT-TNR-HP26' and sl.location_id = :'l8_id') = 1,
  'approved checkout decrements stock 2→1');
select public.t_assert(
  (select count(*) from public.transactions t join public.items i on i.id=t.item_id
    where i.sku='IT-TNR-HP26' and t.type='checkout'
      and t.user_id='aaaaaaaa-0000-0000-0000-000000000002'
      and t.on_behalf_of='aaaaaaaa-0000-0000-0000-000000000001') = 1,
  'approved checkout attributed to requester, approver recorded');

-- ═══ Returns: capped at own recent checkouts ═══
set test.uid = 'bbbbbbbb-0000-0000-0000-000000000001';
select public.kiosk_return(:'tok', :'pen_id', 1, 'took too many');
select public.t_assert(
  (select qty_on_hand from public.stock_levels where item_id=:'pen_id' and location_id=:'l8_id') = 49,
  'return increments stock 48→49');
do $x$ begin
  perform public.kiosk_return(
    (select token from public.kiosk_sessions order by created_at desc limit 1),
    (select id from public.items where sku='STA-PEN-BLU'), 5, null);
  raise exception 'ASSERT FAILED: over-return should be rejected';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: return capped at own net checkouts (%)', sqlerrm;
end $x$;
do $x$ begin
  perform public.kiosk_return(
    (select token from public.kiosk_sessions order by created_at desc limit 1),
    (select id from public.items where sku='PAN-CUP-PAP'), 1, null);
  raise exception 'ASSERT FAILED: returning never-taken item should be rejected';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: cannot return items never checked out (%)', sqlerrm;
end $x$;

-- ═══ Transfer + adjust + stocktake ═══
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select id as bs_id from public.locations where name = 'Basement' \gset
select public.transfer_stock(:'pen_id', :'l8_id', :'bs_id', 10, 'rebalance');
select public.t_assert(
  (select qty_on_hand from public.stock_levels where item_id=:'pen_id' and location_id=:'l8_id') = 39
  and (select qty_on_hand from public.stock_levels where item_id=:'pen_id' and location_id=:'bs_id') = 50,
  'transfer moves 10 units atomically (39 / 50)');
select public.t_assert(
  (select count(distinct transfer_group) from public.transactions where transfer_group is not null) = 1
  and (select count(*) from public.transactions where transfer_group is not null) = 2,
  'transfer writes paired linked ledger rows');

do $x$ begin
  perform public.adjust_stock(
    (select id from public.items where sku='STA-PEN-BLU'),
    (select id from public.locations where name='Level 8'), -1, '  ');
  raise exception 'ASSERT FAILED: adjustment without note should be rejected';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: adjustment requires a reason note (%)', sqlerrm;
end $x$;

select public.apply_stocktake(:'l8_id',
  (select jsonb_build_array(jsonb_build_object('item_id', id, 'counted_qty', 35)) from public.items where sku='STA-PEN-BLU'),
  'smoke stocktake') as st \gset
select public.t_assert(
  (select qty_on_hand from public.stock_levels where item_id=:'pen_id' and location_id=:'l8_id') = 35
  and (select variance from public.stocktake_lines where item_id=:'pen_id') = -4,
  'stocktake writes adjustment and variance (39→35, variance -4)');

-- ═══ CSV import idempotency ═══
select public.import_catalog('[{"sku":"NEW-001","name":"Test glue stick","category":"Stationery","unit":"pcs",
  "stock":[{"location":"Level 8","qty":"7","reorder_point":"2","par_level":"10"}]}]'::jsonb) as imp1 \gset
select public.t_assert((:'imp1'::jsonb->>'created')::int = 1, 'CSV import creates new item');
select public.import_catalog('[{"sku":"NEW-001","name":"Test glue stick","category":"Stationery","unit":"pcs",
  "stock":[{"location":"Level 8","qty":"7","reorder_point":"2","par_level":"10"}]}]'::jsonb) as imp2 \gset
select public.t_assert(
  (:'imp2'::jsonb->>'updated')::int = 1 and (:'imp2'::jsonb->>'stock_adjusted')::int = 0,
  'CSV re-import is idempotent on SKU (no stock drift)');
select public.t_assert(
  (select requires_approval from public.items where sku='IT-TNR-HP26') = true
  and (public.import_catalog('[{"sku":"IT-TNR-HP26","name":"HP 26A toner cartridge","category":"IT Consumables","requires_approval":"","stock":[]}]'::jsonb)->>'updated')::int = 1
  and (select requires_approval from public.items where sku='IT-TNR-HP26') = true,
  'empty requires_approval cell leaves flag unchanged (no crash)');

-- ═══ Reorder dashboard ═══
select public.t_assert(
  exists (select 1 from public.get_reorder_dashboard()
          where sku='PAN-TEA-BAG' and location_name='Level 8' and qty_on_hand=0 and suggested_qty=4),
  'reorder dashboard lists out-of-stock tea bags with suggested qty = par');

-- ═══ Ledger immutability ═══
do $x$ begin
  update public.transactions set note = 'hax' where true;
  raise exception 'ASSERT FAILED: ledger update should be blocked';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: ledger is append-only (%)', sqlerrm;
end $x$;

-- ═══ RLS: kiosk device + staff cannot write stock or read sessions ═══
set role authenticated;
set test.uid = 'bbbbbbbb-0000-0000-0000-000000000001';
do $x$ begin
  insert into public.transactions (type, item_id, location_id, qty_delta, user_id)
  select 'receive', i.id, l.id, 999, 'bbbbbbbb-0000-0000-0000-000000000001'
  from public.items i, public.locations l where i.sku='STA-PEN-BLU' and l.name='Level 8';
  raise exception 'ASSERT FAILED: direct transaction insert should be blocked by RLS';
exception when others then
  if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  raise notice 'PASS: RLS blocks direct ledger writes (%)', sqlerrm;
end $x$;
do $x$ begin
  update public.stock_levels set qty_on_hand = 9999 where true;
  if exists (select 1 from public.stock_levels where qty_on_hand = 9999) then
    raise exception 'ASSERT FAILED: direct stock update should be blocked by RLS';
  end if;
  raise notice 'PASS: RLS blocks direct stock_levels writes (0 rows affected)';
end $x$;
select public.t_assert(
  (select count(*) from public.kiosk_sessions) = 0,
  'kiosk_sessions invisible to clients (RLS deny-all)');

-- staff sees only own transactions
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
select public.t_assert(
  (select count(*) from public.transactions) > 0
  and (select count(*) from public.transactions
       where user_id <> 'aaaaaaaa-0000-0000-0000-000000000002'
         and coalesce(on_behalf_of,'00000000-0000-0000-0000-000000000000') <> 'aaaaaaaa-0000-0000-0000-000000000002') = 0,
  'staff sees only their own ledger rows');
reset role;

select 'ALL SMOKE TESTS PASSED' as result;
