-- Every prop sheet on an event, added up, on the pool's scoreboard (docs/POOL-TYPES.md §9 item 3): once a pool has run two
-- sheets or more on an event (a sheet on every World Series game, migration 223), a row of its own ranks the members by
-- the calls they got right across all of them, the sheets they won breaking a tie, so a run of sheets has a season
-- winner. Kind 'props_all'; a copy of the site that doesn't know it yet reads it plainly. Safe to run twice.

create or replace function public._pool_rows()
returns table (game text, kind text, title text, status text, link text, team_id int, score numeric, possible numeric, alive boolean, tiebreak numeric, line text)
language plpgsql stable security definer set search_path = public as $$
declare lid int := current_league_id(); g record;
begin
  if lid is null then return; end if;

  -- the questions: net worth, the coins in hand plus every call at today's price
  if exists (select 1 from pool_markets m where m.league_id = lid) then
    return query
    select 'questions'::text, 'questions'::text, 'The questions'::text,
      case when exists (select 1 from pool_markets m where m.league_id = lid and m.status = 'open') then 'open' else 'done' end,
      '/questions'::text, l.team_id, l.worth, null::numeric, null::boolean, null::numeric,
      case when l.calls > 0 then format('%s of %s called right', l.hits, l.calls) else 'No settled calls yet' end
    from pool_leaders() l;
  end if;

  -- the sports games: pick the series, rank the teams, squares
  for g in select * from pool_games pg where pg.league_id = lid and pg.kind not in ('survivor', 'score') order by pg.id loop
    return query
    select 'game:' || g.id, g.kind, g.title, g.status, '/picks?g=' || g.id, t.team_id, t.points::numeric,
      case when g.kind = 'squares' then null else t.possible::numeric end, null::boolean, t.tiebreak::numeric,
      case g.kind
        when 'series' then case when t.right_calls > 0 then format('%s right, %s with the length', t.right_calls, t.exact)
                                when t.picked > 0 then format('%s series picked', t.picked) else 'Nothing picked yet' end
        when 'pickem' then case when t.picked > 0 then format('%s right from %s picked', t.right_calls, t.picked) else 'Nothing picked yet' end
        when 'bracket' then case when t.right_calls > 0 then format('%s right', t.right_calls) when t.picked > 0 then 'Bracket in' else 'No bracket yet' end
        when 'players' then case when t.right_calls + t.exact > 0 then format('%s goal%s, %s assist%s', t.right_calls, case when t.right_calls = 1 then '' else 's' end,
                                                                   t.exact, case when t.exact = 1 then '' else 's' end)
                                 when t.picked > 0 then 'Team in' else 'No team yet' end
        when 'props' then case when t.picked > 0 then format('%s right', t.right_calls) else 'No sheet yet' end
        when 'squares' then case when t.picked > 0 then format('%s square%s', t.picked, case when t.picked = 1 then '' else 's' end) else 'No squares' end
        else case when t.picked > 0 then 'Ranked' else 'Not ranked yet' end end
    from _pool_game_table(g.id) t;
  end loop;

  -- every prop sheet on an event, added up: the calls right across them, then the sheets won
  for g in select pg.competition, max(pg.id) latest, bool_or(pg.status = 'open') going, min(c.name) cname
           from pool_games pg join competitions c on c.id = pg.competition
           where pg.league_id = lid and pg.kind = 'props' group by pg.competition having count(*) >= 2 order by pg.competition loop
    return query
    select 'props:' || g.competition, 'props_all'::text, 'Every prop sheet · ' || g.cname, case when g.going then 'open' else 'done' end,
      '/picks?g=' || g.latest, x.team_id, x.pts::numeric, x.poss::numeric, null::boolean, (-x.wins)::numeric,
      case when x.sheets > 0 then format('%s right on %s sheet%s%s', x.pts, x.sheets, case when x.sheets = 1 then '' else 's' end,
                                         case when x.wins > 0 then format(', %s won', x.wins) else '' end)
           else 'No sheets yet' end
    from (select t.team_id, sum(t.points)::int pts, sum(t.possible)::int poss, sum(t.picked)::int sheets,
            count(*) filter (where t.team_id = any (coalesce(pg.winners, '{}')))::int wins
          from pool_games pg cross join lateral _pool_game_table(pg.id) t
          where pg.league_id = lid and pg.kind = 'props' and pg.competition = g.competition
          group by t.team_id) x;
  end loop;

  -- last one standing: still in (or the winner, once it's over) first, then the rounds survived, then who went out
  -- latest
  for g in select * from pool_survivors s where s.league_id = lid order by s.id loop
    return query
    select 'survivor:' || g.id, 'survivor'::text, 'Last one standing'::text, g.status, '/survivor'::text, x.id,
      x.through::numeric, null::numeric, x.alive, (-coalesce(x.out_gw, 0))::numeric,
      case when g.status = 'done' and x.alive then 'Won it' when x.alive then 'Still in'
           when x.out_gw is not null then format('Out in %s %s', lower(_round_word(g.competition)), x.out_gw) else 'Out' end
    from (select tm.id,
            case when g.status = 'done' then tm.id = any(coalesce(g.winners, '{}')) else _survivor_alive(g.id, tm.id) end alive,
            (select count(*) from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result = 'through')::int through,
            (select min(p.gameweek) from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result in ('out', 'missed')) out_gw
          from teams tm where tm.league_id = lid and tm.role = 'gm') x;
  end loop;

  -- call the score: points, then exact scores
  for g in select * from pool_predictors s where s.league_id = lid order by s.id loop
    return query
    select 'predictor:' || g.id, 'score'::text, 'Call the score'::text, g.status, '/predictor'::text, x.id,
      x.pts::numeric, null::numeric, null::boolean, (-x.ex)::numeric,
      case when x.rt > 0 then format('%s exact, %s right', x.ex, x.rt) else 'No points yet' end
    from (select tm.id, coalesce(sum(p.points), 0)::int pts,
            count(*) filter (where p.points > 0 and p.home = coalesce(f.home_ft, f.home_score) and p.away = coalesce(f.away_ft, f.away_score))::int ex,
            count(*) filter (where p.points > 0)::int rt
          from teams tm
          left join pool_predictor_picks p on p.predictor_id = g.id and p.team_id = tm.id
          left join fixtures f on f.id = p.fixture_id
          where tm.league_id = lid and tm.role = 'gm'
          group by tm.id) x;
  end loop;
end $$;
revoke execute on function public._pool_rows() from public, anon, authenticated;
