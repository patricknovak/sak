-- The host's one-tap answer names the game on a call about one game (18 October 2026): the settle panel read
-- "Milwaukee Brewers (World Series)" for "Who wins Game 1 of the World Series?"; it reads "(World Series, Game 1)" now,
-- and so does the settled question's note. Safe to run twice.

create or replace function public.pool_feed_answer(p_market bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m record; ans text; o jsonb;
begin
  perform _in_league('pool_markets', p_market);
  select pm.outcomes, e.value->'feed' as feed into m
    from pool_markets pm
    join pool_packs p on p.slug = pm.pack
    cross join lateral jsonb_array_elements(p.markets) e
    where pm.id = p_market and pm.status = 'open' and e.value->>'title' = pm.title and e.value ? 'feed'
    limit 1;
  if m.feed is null then return null; end if;
  ans := _feed_answer(m.feed);
  if ans is null then return null; end if;
  select x into o from jsonb_array_elements(m.outcomes) x where lower(x->>'label') = lower(ans) limit 1;
  if o is null then return null; end if;
  -- a call on one game names it (migration 324): "World Series, Game 1"
  return jsonb_build_object('key', o->>'key', 'label', o->>'label',
    'series', m.feed->>'series' || case when m.feed->>'kind' = 'game' then ', Game ' || (m.feed->>'game') else '' end);
end $$;
revoke execute on function public.pool_feed_answer(bigint) from public, anon;
grant execute on function public.pool_feed_answer(bigint) to authenticated;
