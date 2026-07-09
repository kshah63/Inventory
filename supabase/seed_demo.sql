-- ═══════════════════════════════════════════════════════════════════════════
-- OPTIONAL demo catalog — run after 0001_init.sql if you want sample items
-- to explore the app before importing your real stocktake CSV.
-- Safe to skip entirely; safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_l8 uuid;
  v_bs uuid;
  v_item uuid;
  r record;
begin
  select id into v_l8 from public.locations where name = 'Level 8';
  select id into v_bs from public.locations where name = 'Basement';

  for r in
    select * from (values
      ('STA-PEN-BLU',  'Ballpoint pen (blue)',        'Stationery',         'pcs',   50, 8, 10, 40, 6, 30, null::int, false),
      ('STA-PEN-RED',  'Ballpoint pen (red)',         'Stationery',         'pcs',   30, 5, 20, 24, 4, 15, null, false),
      ('STA-MRK-WBL',  'Whiteboard marker (blue)',    'Teaching Materials', 'pcs',   24, 6, 20, 36, 8, 30, 4, false),
      ('STA-MRK-WBK',  'Whiteboard marker (black)',   'Teaching Materials', 'pcs',   18, 6, 20, 30, 8, 30, 4, false),
      ('STA-STK-PST',  'Sticky notes 76x76 (pad)',    'Stationery',         'pack',  12, 4, 12, 10, 3, 10, null, false),
      ('PPR-A4-80',    'A4 paper 80gsm (ream)',       'Printing & Paper',   'ream',  10, 4, 20, 25, 8, 40, 2, false),
      ('PPR-A3-80',    'A3 paper 80gsm (ream)',       'Printing & Paper',   'ream',   3, 1,  4,  5, 2,  6, 1, false),
      ('IT-TNR-HP26',  'HP 26A toner cartridge',      'IT Consumables',     'pcs',    2, 1,  3,  1, 1,  2, 1, true),
      ('IT-USB-32',    'USB drive 32GB',              'IT Consumables',     'pcs',    5, 2,  6,  0, 0,  0, 1, true),
      ('PAN-CUP-PAP',  'Paper cups (pack of 50)',     'Pantry',             'pack',   6, 2,  8,  9, 3, 10, null, false),
      ('PAN-TEA-BAG',  'Tea bags (box of 100)',       'Pantry',             'box',    3, 1,  4,  2, 1,  3, null, false),
      ('CLN-WIP-DIS',  'Disinfectant wipes (tub)',    'Cleaning',           'bottle', 4, 2,  6,  5, 2,  6, null, false),
      ('CLN-TIS-BOX',  'Tissue box',                  'Cleaning',           'box',   12, 4, 16, 18, 6, 20, null, false),
      ('TCH-CRD-A5',   'Flash cards A5 (pack)',       'Teaching Materials', 'pack',   8, 2,  8,  6, 2,  8, null, false),
      ('FA-PLA-STD',   'Plasters (box)',              'First Aid',          'box',    2, 1,  3,  2, 1,  3, null, false)
    ) as t(sku, name, category, unit, l8_qty, l8_reorder, l8_par, bs_qty, bs_reorder, bs_par, max_per_checkout, requires_approval)
  loop
    insert into public.items (sku, name, category_id, unit, max_per_checkout, requires_approval)
    values (
      r.sku, r.name,
      (select id from public.categories where name = r.category),
      r.unit, r.max_per_checkout, r.requires_approval
    )
    on conflict (sku) do nothing
    returning id into v_item;

    if v_item is null then
      select id into v_item from public.items where sku = r.sku;
    end if;

    insert into public.stock_levels (item_id, location_id, qty_on_hand, reorder_point, par_level)
    values (v_item, v_l8, r.l8_qty, r.l8_reorder, r.l8_par)
    on conflict (item_id, location_id) do nothing;

    insert into public.stock_levels (item_id, location_id, qty_on_hand, reorder_point, par_level)
    values (v_item, v_bs, r.bs_qty, r.bs_reorder, r.bs_par)
    on conflict (item_id, location_id) do nothing;

    v_item := null;
  end loop;
end $$;
