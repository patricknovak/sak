-- A missed pick takes the favourite (docs/POOL-TYPES.md §2.4, 15 October 2026): the office pool's most asked-for knob,
-- since someone always forgets Thursday night. A pick'em started (or changed before the first lock) with
-- `rules.missed = 'favourite'` fills, the moment a game starts, the pick of every member who made none: the side the
-- market favours at kick-off (ESPN's chances, frozen then; against the spread, the side giving points; no line at all,
-- the home side), never a draw, with the lowest Confidence number still free that round, and the line of the moment
-- against the spread. The pick is marked `auto`, the board says so, and the crowd's split leaves it out (it is the
-- market's call, not the member's). The default stays as it was: a missed pick scores zero.

-- fill the missed picks on one game that has just started, in every pick'em on its competition that asks for it
create or replace function public._pickem_autopick(p_fixture bigint) returns int
language plpgsql security definer set search_path = public as $$
declare f fixtures; g pool_games; t record; side text; cf int; n int := 0; o jsonb; ln numeric; size int;
begin
  select * into f from fixtures where id = p_fixture;
  if f.id is null or f.gameweek is null or f.state in ('scheduled', 'postponed', 'cancelled') then return 0; end if;
  o := f.detail->'odds';
  for g in select * from pool_games pg where pg.kind = 'pickem' and pg.status = 'open' and pg.competition = f.competition
             and pg.rules->>'missed' = 'favourite'
             and f.gameweek between (pg.rules->>'from_round')::int and (pg.rules->>'to_round')::int loop
    ln := case when g.rules->>'ats' = 'true' then coalesce((o->>'line')::numeric, 0) end;
    side := case when ln is not null then case when ln > 0 then 'A' else 'H' end
                 when (o->>'home') is not null and (o->>'away') is not null and (o->>'away')::numeric > (o->>'home')::numeric then 'A'
                 else 'H' end;
    size := (select count(*) from fixtures where competition = f.competition and gameweek = f.gameweek);
    for t in select tm.id from teams tm where tm.league_id = g.league_id and tm.role = 'gm'
               and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'f:' || f.id) loop
      cf := null;
      if g.rules->>'preset' = 'confidence' then
        select min(x) into cf from generate_series(1, size) x
        where not exists (select 1 from pool_picks pk join fixtures fx on pk.thing = 'f:' || fx.id
                          where pk.game_id = g.id and pk.team_id = t.id and fx.gameweek = f.gameweek and (pk.pick->>'conf')::int = x);
        if cf is null then continue; end if;
      end if;
      insert into pool_picks (game_id, team_id, thing, pick)
      values (g.id, t.id, 'f:' || f.id, jsonb_strip_nulls(jsonb_build_object('pick', side, 'conf', cf, 'line', ln, 'auto', true)))
      on conflict (game_id, team_id, thing) do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pickem_autopick(bigint) from public, anon, authenticated;

-- a game leaves 'scheduled' (under way, or straight to final when the feed was late): fill the missed picks first, so
-- the round's end and the split that follow read them (triggers on the same event fire in name order)
create or replace function public._pickem_auto_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.state = 'scheduled' and new.state not in ('scheduled', 'postponed', 'cancelled') then perform _pickem_autopick(new.id); end if;
  return new;
end $$;
revoke execute on function public._pickem_auto_fixture() from public, anon, authenticated;
drop trigger if exists fixtures_pickem_auto on public.fixtures;
create trigger fixtures_pickem_auto after update of state on public.fixtures
  for each row execute function public._pickem_auto_fixture();

create or replace function public._pickem_rules(p_competition text, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ev record; fr int; tr int; preset text; draws boolean; ats boolean; missed text;
begin
  draws := coalesce((select (s.config->>'draws')::boolean from competitions c join sports s on s.id = c.sport where c.id = p_competition), false);
  -- against the spread: each pick is on a side with the market's line at the moment it is made; a sport with draws
  -- (soccer) plays its own handicaps, so it stays straight up
  ats := coalesce((r->>'ats')::boolean, false);
  if ats and draws then raise exception 'Against the spread is for sports without draws'; end if;
  select * into ev from _pickem_rounds(p_competition);
  if ev.last_round is null then raise exception 'That event has no rounds yet'; end if;
  if ev.open_round is null then raise exception 'Every round of that event has started'; end if;
  fr := coalesce((r->>'from_round')::int, ev.open_round);
  if fr < ev.open_round then raise exception 'That round is over; start from the next one'; end if;
  tr := coalesce((r->>'to_round')::int, ev.last_round);
  if fr > ev.last_round or tr < fr or tr > ev.last_round then raise exception 'No such round'; end if;
  preset := coalesce(r->>'preset', 'classic');
  if preset not in ('classic', 'confidence') then raise exception 'Pick a scoring: Classic or Confidence'; end if;
  -- a pick nobody made: zero (the default), or the market's favourite at kick-off (migration 285)
  missed := coalesce(r->>'missed', 'zero');
  if missed not in ('zero', 'favourite') then raise exception 'A missed pick scores zero or takes the favourite'; end if;
  return jsonb_build_object('preset', preset, 'from_round', fr, 'to_round', tr, 'draws', draws)
    || case when ats then '{"ats": true}'::jsonb else '{}'::jsonb end
    || case when missed = 'favourite' then '{"missed": "favourite"}'::jsonb else '{}'::jsonb end;
end $$;

create or replace function public._pool_split_write(p_game bigint, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; h int; d int; a int; n int; top int; fav text;
begin
  select * into g from pool_games where id = p_game and kind in ('pickem', 'streak');
  select * into f from fixtures where id = p_fixture;
  -- a pick against the spread is a call on the line, not on who wins: the crowd's forecast of the winner is the
  -- straight-up pools' (migration 283)
  if g.rules->>'ats' = 'true' then return; end if;
  if g.id is null or f.id is null or f.competition <> g.competition
     or (g.kind = 'pickem' and f.gameweek not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int) then return; end if;
  -- pick'em's picks are by match; the streak's by day, each naming its game (migration 235)
  select count(*) filter (where pick->>'pick' = 'H'), count(*) filter (where pick->>'pick' = 'D'), count(*) filter (where pick->>'pick' = 'A')
    into h, d, a from pool_picks
  -- a pick the pool made for a member who forgot (migration 285) is the market's, not the crowd's
  where game_id = g.id and not (pick ? 'auto') and case when g.kind = 'streak' then thing like 'd:%' and (pick->>'fixture')::bigint = f.id else thing = 'f:' || f.id end;
  n := h + d + a;
  top := greatest(h, d, a);
  if n < 3 or (h = top)::int + (d = top)::int + (a = top)::int > 1 then return; end if;
  fav := case when h = top then 'H' when a = top then 'A' else 'D' end;
  insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
  values (g.league_id, 'pool_split', jsonb_build_object('game', g.id, 'fixture', f.id), round(top::numeric / n, 3), f.sport,
    least(f.kickoff, now()), f.date,
    jsonb_build_object('fav', fav, 'H', h, 'D', d, 'A', a, 'picks', n, 'competition', f.competition, 'round', f.gameweek,
      -- what the market gave the pool's favourite at kick-off, when the feed carries it
      'market', case fav when 'H' then f.detail->'odds'->'home' when 'A' then f.detail->'odds'->'away' else f.detail->'odds'->'draw' end))
  on conflict (league_id, kind, subject) do nothing;
end $$;

create or replace function public._pickem_board(p_game bigint, p_round int, p_me int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; fr int; tr int; cur int;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null or g.kind <> 'pickem' then return null; end if;
  fr := (g.rules->>'from_round')::int; tr := (g.rules->>'to_round')::int;
  cur := coalesce(p_round, (select min(gameweek) from fixtures where competition = g.competition and gameweek between fr and tr and state in ('scheduled', 'live')), tr);
  cur := greatest(fr, least(tr, cur));
  return jsonb_build_object('round', cur, 'from_round', fr, 'to_round', tr, 'word', _round_word(g.competition),
    'confidence', g.rules->>'preset' = 'confidence', 'draws', coalesce((g.rules->>'draws')::boolean, false),
    'ats', coalesce((g.rules->>'ats')::boolean, false),
    'missed', coalesce(g.rules->>'missed', 'zero'),
    'size', (select count(*) from fixtures where competition = g.competition and gameweek = cur),
    -- the round's tiebreaker: the total in its last game, locked when that game starts
    'tiebreak', (select jsonb_build_object('fixture', f.id, 'kickoff', f.kickoff, 'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'locked', f.state <> 'scheduled' or f.kickoff <= now(),
        'total', case when f.state = 'final' then coalesce(f.home_ft, f.home_score) + coalesce(f.away_ft, f.away_score) end,
        'mine', (select (pk.pick->>'runs')::int from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 't:' || cur),
        'word', _sport_word(g.competition, 'score', 'points'), 'cap', _score_cap(g.competition))
      from fixtures f where f.id = _pickem_last(g.competition, cur)),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', x.gw, 'first', x.first, 'last', x.last, 'matches', x.n, 'done', x.done, 'open', x.open,
        'picked', (select count(*) from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw),
        'points', (select coalesce(sum(case when (g.rules->>'preset') = 'confidence' then coalesce((pk.pick->>'conf')::int, 1) else 1 end), 0)
                   from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
                   where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw
                     and pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))))
        order by x.gw)
      from (select gameweek gw, min(kickoff) first, max(kickoff) last, count(*)::int n,
              bool_and(state in ('final', 'postponed', 'cancelled')) done, count(*) filter (where state = 'scheduled' and kickoff > now())::int open
            from fixtures where competition = g.competition and gameweek between fr and tr group by gameweek) x), '[]'),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state, 'minute', f.minute,
        'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'home_score', coalesce(f.home_ft, f.home_score), 'away_score', coalesce(f.away_ft, f.away_score),
        'result', e.res, 'void', e.void,
        -- the host's word on a match the feed got wrong or never finished, and why
        'host', case when e.by_host then jsonb_build_object('reason', e.reason) end,
        'locked', f.state <> 'scheduled' or f.kickoff <= now() or e.by_host,
        'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'f:' || f.id),
        -- against the spread: the home side's line now (what a pick made now is made at), and what my pick's own line
        -- made of the result
        'line', case when g.rules->>'ats' = 'true' then coalesce((f.detail->'odds'->>'line')::numeric, 0) end,
        'mine_res', case when g.rules->>'ats' = 'true' then (select _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))
                                                            from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'f:' || f.id) end,
        'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id),
        -- the pool's split and everyone's picks, once the match has kicked off (never before: the picks would be a copy)
        'split', case when f.state <> 'scheduled' or f.kickoff <= now() then
            (select jsonb_build_object('H', count(*) filter (where pk.pick->>'pick' = 'H'), 'D', count(*) filter (where pk.pick->>'pick' = 'D'),
                                       'A', count(*) filter (where pk.pick->>'pick' = 'A'))
             from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id) end,
        'calls', case when f.state <> 'scheduled' or f.kickoff <= now() then
            coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('team_id', pk.team_id, 'pick', pk.pick->>'pick', 'conf', (pk.pick->>'conf')::int,
                        'line', (pk.pick->>'line')::numeric)) order by pk.team_id)
                      from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id), '[]') end)
      order by f.kickoff, f.id)
      from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e where f.competition = g.competition and f.gameweek = cur), '[]'));
end $$;
