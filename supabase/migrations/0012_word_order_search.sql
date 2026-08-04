-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0012 — Search that doesn't care what order you type the words in
--
--  0011 matched the phrase as one string, so "blue pen" found the ballpoint
--  and "pen blue" found nothing. Nobody should have to guess our word order.
--
--  The query is now split into words and each must appear somewhere in the
--  item's name, code or aliases — in any order, and a trailing "s" is
--  forgiven, so "pens blue" works too. An exact phrase still ranks highest.
-- Run once, after 0011. Safe on a live database.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.search_catalogue(p_query text, p_limit int default 3)
returns table (
  item_id uuid, sku text, name text, unit text, qty_on_hand bigint,
  max_per_order int, matched_alias text, score real
)
language sql stable security definer set search_path = public, extensions
as $$
  with q as (
    select
      lower(trim(coalesce(p_query, ''))) as phrase,
      -- Punctuation separates words, so "A4 paper (ream)" and "a4 ream
      -- paper" come out as the same set.
      array_remove(
        regexp_split_to_array(lower(trim(coalesce(p_query, ''))), '[^a-z0-9]+'),
        ''
      ) as tokens
  ),
  haystack as (
    select
      i.id, i.sku, i.name, i.unit, i.max_per_checkout,
      -- One place to look: what it's called, its code, and every name
      -- procurement has taught us for it.
      lower(
        i.name || ' ' || i.sku || ' ' ||
        coalesce((select string_agg(a.alias, ' ')
                  from public.item_aliases a where a.item_id = i.id), '')
      ) as text
    from public.items i
    where i.is_active
  ),
  scored as (
    select
      h.id, h.sku, h.name, h.unit, h.max_per_checkout,
      greatest(
        -- The code, typed exactly.
        case when lower(h.sku) = q.phrase then 1.0 else 0 end,
        -- The whole phrase, as typed, appears — the strongest signal short
        -- of the code itself.
        case when q.phrase <> '' and position(q.phrase in h.text) > 0
             then 0.9 else 0 end,
        -- Every word present, in any order. Just below an exact phrase, so
        -- "blue pen" still ranks the ballpoint above a fuzzy neighbour.
        case
          when cardinality(q.tokens) > 0 and (
            select bool_and(
              position(t in h.text) > 0
              -- "pens" should find "pen"; only for words long enough that
              -- chopping a letter can't turn them into something else.
              or (length(t) >= 4 and right(t, 1) = 's'
                  and position(left(t, length(t) - 1) in h.text) > 0)
            )
            from unnest(q.tokens) t
          ) then 0.85 else 0
        end,
        -- Typos, via trigrams.
        similarity(lower(h.name), q.phrase)
      )::real as score,
      (
        select a.alias from public.item_aliases a
        where a.item_id = h.id
          and (position(q.phrase in lower(a.alias)) > 0
               or similarity(lower(a.alias), q.phrase) > 0.3)
        order by similarity(lower(a.alias), q.phrase) desc
        limit 1
      ) as matched_alias
    from haystack h, q
    where length(q.phrase) >= 2
  )
  select
    s.id, s.sku, s.name, s.unit,
    coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
              where sl.item_id = s.id), 0),
    s.max_per_checkout,
    s.matched_alias,
    s.score
  from scored s
  where s.score >= 0.3
  -- Ties broken by the shorter name: "Ballpoint pen (blue)" before
  -- "Ballpoint pen (blue) refill pack", since the plainer one is usually
  -- what was meant.
  order by s.score desc, length(s.name), s.name
  limit greatest(1, least(coalesce(p_limit, 3), 10))
$$;

grant execute on function public.search_catalogue(text, int) to authenticated;
