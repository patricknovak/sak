-- What the feed says on one question (migration 272's answers, read by the host's settle panel): the outcome the
-- decided series gives, so the host settles with one tap instead of reading the series elsewhere. Null when the
-- question names no feed, the series isn't decided or the answer isn't one of its outcomes. A member of the question's
-- league reads it; the answer is a series result, nothing private.
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
  return jsonb_build_object('key', o->>'key', 'label', o->>'label', 'series', m.feed->>'series');
end $$;
revoke execute on function public.pool_feed_answer(bigint) from public, anon;
grant execute on function public.pool_feed_answer(bigint) to authenticated;
