-- The host hears when the feed already has a question's answer (14 October 2026: the World Series pool's two pennant
-- questions and the seven-games question closed on 11 and 12 October and wait on the host, while mlb-sync carries both
-- Championship Series game by game). A pack's question can name where its answer comes from (`feed` on the pack's
-- entry, matched to a pool's copy by its pack and title, so every pool on the pack has it with nothing copied); once
-- the series it follows is decided, each commissioner of a pool where it's still open gets one bell with the answer,
-- linking to the question. The host still calls it: coins move only on a person's say.
--
-- The kinds a feed names (`competition` is the series' competition, `series` its label):
--   winner      the series' winner, the outcome whose label is the club's name
--   winner_is   'Yes' when `club` wins the series, 'No' when it's decided and someone else did
--   games       how many games the series went, as the outcome's word ('Four' ... 'Seven')
--   winner_from the label `from` gives the series the winner came out of (the league that wins the World Series)
--   game7       'Yes' once any best-of-7 series in `round` reaches 3-3, 'No' once every one is decided short of it

create or replace function public._feed_answer(p_feed jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare s record; w text; k text := p_feed->>'kind'; comp text := p_feed->>'competition';
begin
  if k = 'game7' then
    if exists (select 1 from series where competition = comp and round = (p_feed->>'round')::int and best_of = 7
               and high_wins >= 3 and low_wins >= 3) then return 'Yes'; end if;
    if exists (select 1 from series where competition = comp and round = (p_feed->>'round')::int and best_of = 7)
       and not exists (select 1 from series where competition = comp and round = (p_feed->>'round')::int and best_of = 7
                       and winner is null) then return 'No'; end if;
    return null;
  end if;
  select * into s from series where competition = comp and label = p_feed->>'series' order by id desc limit 1;
  if s.id is null or s.winner is null then return null; end if;
  select name into w from clubs where id = s.winner;
  if k = 'winner' then return w; end if;
  if k = 'winner_is' then return case when lower(w) = lower(p_feed->>'club') then 'Yes' else 'No' end; end if;
  if k = 'games' then
    return (array['One','Two','Three','Four','Five','Six','Seven'])[s.high_wins + s.low_wins];
  end if;
  if k = 'winner_from' then
    return (select e.value #>> '{}' from jsonb_each(p_feed->'from') e
            join series f on f.competition = comp and f.label = e.key and f.winner = s.winner limit 1);
  end if;
  return null;
end $$;
revoke execute on function public._feed_answer(jsonb) from public, anon, authenticated;

create or replace function public._pool_feed_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare m record; ans text; o jsonb; h record; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for m in select pm.id, pm.title, pm.outcomes, pm.closes_at, e.value->'feed' as feed
           from pool_markets pm
           join pool_packs p on p.slug = pm.pack
           cross join lateral jsonb_array_elements(p.markets) e
           where pm.league_id = p_league and pm.status = 'open' and e.value->>'title' = pm.title and e.value ? 'feed'
             and not exists (select 1 from private.soccer_nudged z where z.game = 'feed:' || pm.id and z.game_id = p_league) loop
    ans := _feed_answer(m.feed);
    if ans is null then continue; end if;
    select x into o from jsonb_array_elements(m.outcomes) x where lower(x->>'label') = lower(ans) limit 1;
    if o is null then continue; end if;   -- the answer isn't one of the pool's outcomes: the host decides it unprompted
    for h in select t.id from teams t where t.league_id = p_league and t.is_commish and t.user_id is not null loop
      perform _pool_alert(h.id, 'pool_settle',
        format('📡 The feed has it: "%s" went %s. %s', left(m.title, 80), o->>'label',
               case when m.closes_at > now() then 'Calls are still open, so call it now on the question.'
                    else 'Call it on the question to pay the pool.' end),
        '/q/' || m.id);
    end loop;
    insert into private.soccer_nudged (game, game_id, team_id, gameweek) values ('feed:' || m.id, p_league, 0, 0) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_feed_nudge(int) from public, anon, authenticated;

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pack_refresh(current_league_id()) + _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _props_auto(current_league_id()) + _pool_host_nudge(current_league_id()) + _pool_settle_nudge(current_league_id()) + _pool_feed_nudge(current_league_id()) + _streak_close(current_league_id()) + _sweep_tick(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;

-- the World Series pack's questions the feed can answer
update public.pool_packs p set markets = (
  select jsonb_agg(case e->>'title'
      when 'Who wins the World Series?' then e || '{"feed":{"kind":"winner","competition":"mlb-post-2026","series":"World Series"}}'
      when 'Do the Dodgers win a third straight World Series?' then e || '{"feed":{"kind":"winner_is","competition":"mlb-post-2026","series":"World Series","club":"Los Angeles Dodgers"}}'
      when 'How many games does the World Series go?' then e || '{"feed":{"kind":"games","competition":"mlb-post-2026","series":"World Series"}}'
      when 'Which league wins the World Series?' then e || '{"feed":{"kind":"winner_from","competition":"mlb-post-2026","series":"World Series","from":{"AL Championship Series":"American League","NL Championship Series":"National League"}}}'
      when 'Who wins the American League pennant?' then e || '{"feed":{"kind":"winner","competition":"mlb-post-2026","series":"AL Championship Series"}}'
      when 'Who wins the National League pennant?' then e || '{"feed":{"kind":"winner","competition":"mlb-post-2026","series":"NL Championship Series"}}'
      when 'Does either League Championship Series go seven games?' then e || '{"feed":{"kind":"game7","competition":"mlb-post-2026","round":3}}'
      else e end order by ord)
  from jsonb_array_elements(p.markets) with ordinality x(e, ord))
where p.slug = 'world-series-2026';
