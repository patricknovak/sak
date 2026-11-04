-- Love Is Blind Season 11: the last question closes when the reunion airs, as its rule says.
--
-- "Will any couple still be together at the reunion?" says "Closes when the reunion drops", but the pack (migrations 145
-- and 251) carried 11 November 08:00 UTC, a guess made before Netflix named the date. The reunion airs Sunday 8 November
-- at 9 pm ET (9 November 02:00 UTC), so the old time left two days in which a call could be made with the answer on
-- screen. The pack's question and every open copy of it close at the reunion; a copy a host already moved earlier, or
-- settled, is left alone. Safe to run twice.

update pool_packs p
set markets = (
  select jsonb_agg(case
           when q->>'title' = 'Will any couple still be together at the reunion?'
                and (q->>'closes_at')::timestamptz > '2026-11-09T02:00:00Z'
             then jsonb_set(q, '{closes_at}', to_jsonb('2026-11-09T02:00:00Z'::text))
           else q end
         order by ord)
  from jsonb_array_elements(p.markets) with ordinality as e(q, ord))
where p.slug = 'love-is-blind-s11'
  and exists (select 1 from jsonb_array_elements(p.markets) q
              where q->>'title' = 'Will any couple still be together at the reunion?'
                and (q->>'closes_at')::timestamptz > '2026-11-09T02:00:00Z');

update pool_markets
set closes_at = '2026-11-09T02:00:00Z'
where pack = 'love-is-blind-s11'
  and title = 'Will any couple still be together at the reunion?'
  and status = 'open'
  and closes_at > '2026-11-09T02:00:00Z';
