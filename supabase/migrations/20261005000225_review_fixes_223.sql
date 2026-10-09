-- Fixes from an independent review of migrations 218 to 223. Safe to run twice.
--  * A grid on a game called off is marked done before its coins go back, so two runs at once (the live feed and the
--    hourly job) can't refund it twice.
--  * One open prop sheet a game, enforced by the table (a double tap, or the host and the hourly job at once).
--  * Automatic sheets open only on a series' next game, never on an "if necessary" game that may not be played.
--  * A live 1st-period call waits for that period's score (a feed that sends the 2nd before the 1st's numbers).

-- a pool runs one open sheet on a game (live has none yet that this could refuse)
create unique index if not exists pool_games_one_open_sheet on public.pool_games (league_id, ((rules->>'fixture')::bigint))
  where kind = 'props' and status = 'open';

create or replace function public._squares_tick(p_competition text, p_league int default null) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; f fixtures; i int; pt int; w int; pot int; sz int; top_c bigint; tr int; sr int;
  cell text; own record; amt int; paid int; n int := 0; h record; rem int; nsq int; last_no int; top_name text; side_name text; best record; dname text; moment text;
begin
  for g in select * from pool_games where kind = 'squares' and status = 'open'
             and (p_competition is null or competition = p_competition) and (p_league is null or league_id = p_league) order by id loop
    s := _squares_series(g.id);
    -- a week's game put off waits for its new kickoff; one called off hands back what's left of the pot, square by square
    if s.state = 'postponed' then continue; end if;
    if s.state = 'cancelled' then
      -- done first: a second run at the same moment finds it done and refunds nothing
      update pool_games set status = 'done', winners = '{}' where id = g.id and status = 'open';
      if not found then continue; end if;
      nsq := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
      rem := coalesce((g.draw->>'pot')::int, nsq * (g.rules->>'cost')::int) - coalesce((select sum(coins) from pool_square_pays where game_id = g.id), 0);
      for h in select team_id, count(*) k from pool_picks where game_id = g.id and thing like 'sq:%' group by team_id loop
        amt := floor(rem * h.k / nsq::numeric)::int;
        if amt > 0 then
          insert into coin_ledger (team_id, amount, reason) values (h.team_id, amt, format('Squares back: %s · called off', g.title));
          perform _pool_alert(h.team_id, 'pool_game', format('🔲 %s was called off: %s coins back for your square%s.', g.title, amt, case when h.k = 1 then '' else 's' end), '/picks?g=' || g.id);
        end if;
      end loop;
      if nsq > 0 then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🔲 The game was called off, so %s are done and every square''s coins go back.', g.title), jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
      continue;
    end if;
    if g.draw is null then
      if s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now()) then continue; end if;
      perform _squares_draw(g.id, _sport_word(g.competition, 'start', 'first pitch'));
      select * into g from pool_games where id = g.id;
      if g.status <> 'open' then continue; end if;
    end if;
    -- the clubs on each side, once the series has them (a grid can fill before its matchup is set)
    if g.draw->>'top' is null and s.high_club is not null then
      update pool_games set draw = draw || jsonb_build_object('top', s.high_club, 'side', s.low_club) where id = g.id returning * into g;
    end if;
    top_c := (g.draw->>'top')::bigint;
    if top_c is null then continue; end if;
    pot := (g.draw->>'pot')::int; sz := (g.rules->>'size')::int;
    top_name := (select coalesce(short, name) from clubs where id = top_c);
    side_name := (select coalesce(short, name) from clubs where id = (g.draw->>'side')::bigint);
    -- a week's game that ends level wins nobody a "game", and is still its grid's last
    last_no := case when s.state = 'final' then greatest(s.high_wins + s.low_wins, 1) end;
    for f in select * from _squares_fixtures(g.id) x where x.state in ('live', 'final') order by x.game_no loop
      for i in 0 .. jsonb_array_length(g.rules->'points') - 1 loop
        pt := (g.rules->'points'->>i)::int; w := (g.rules->'weights'->>i)::int;
        continue when exists (select 1 from pool_square_pays where game_id = g.id and fixture_id = f.id and point = pt);
        if pt = 0 then
          continue when f.state <> 'final';
          tr := case when f.home_club = top_c then f.home_score else f.away_score end;
          sr := case when f.home_club = top_c then f.away_score else f.home_score end;
        else
          -- an inning is in once the next one has begun, or the game is over; either way only once the feed has sent it
          continue when not exists (select 1 from fixture_periods where fixture_id = f.id
                                    and (case when f.state = 'final' then fixture_periods.n >= pt else fixture_periods.n > pt and away is not null end));
          select sum(case when f.home_club = top_c then home else away end), sum(case when f.home_club = top_c then away else home end)
          into tr, sr from fixture_periods where fixture_id = f.id and fixture_periods.n <= pt;
          tr := coalesce(tr, 0); sr := coalesce(sr, 0);
        end if;
        continue when tr is null or sr is null;
        cell := _squares_cell(g.draw, sz, f.game_no, tr, sr);
        select * into own from _squares_owner(g.id, sz, cell);
        paid := coalesce((select sum(coins) from pool_square_pays where game_id = g.id), 0);
        amt := case when pt = 0 and f.game_no = last_no then pot - paid else floor(pot * w / (100.0 * s.best_of))::int end;
        insert into pool_square_pays (game_id, league_id, fixture_id, game_no, point, top_runs, side_runs, cell, paid_cell, team_id, coins)
        values (g.id, g.league_id, f.id, f.game_no, pt, tr, sr, cell, own.cell, own.team_id, greatest(amt, 0));
        dname := (select coalesce(gm_name, name) from teams where id = own.team_id);
        if amt > 0 and own.team_id is not null then
          -- a series names the game; a single game (the Super Bowl) needs no number
          moment := _squares_moment(pt, g.competition);
          insert into coin_ledger (team_id, amount, reason) values (own.team_id, amt,
            case when s.best_of > 1 then format('Squares: %s · Game %s, %s', g.title, f.game_no, moment) else format('Squares: %s · %s', g.title, moment) end);
          perform _pool_alert(own.team_id, 'pool_game', format('🔲 Your square hit: %s %s, %s %s, %s. +%s coins', top_name, tr, side_name, sr,
            case when s.best_of > 1 then format('Game %s %s', f.game_no, moment) else moment end, amt),
            '/picks?g=' || g.id);
          insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
            format('🔲 %s: %s %s, %s %s. %s%s square takes %s coins.',
              case when s.best_of > 1 then format('Game %s, %s', f.game_no, moment) else upper(left(moment, 1)) || substr(moment, 2) end, top_name, tr, side_name, sr, dname,
              case when own.cell is distinct from cell then '''s next' else '''s' end, amt),
            jsonb_build_object('pool_game', g.id, 'fixture', f.id), g.league_id);
        end if;
        n := n + 1;
      end loop;
    end loop;
    -- the series is over and its last final is paid: the grid is done
    if last_no is not null and exists (select 1 from pool_square_pays p where p.game_id = g.id and p.point = 0 and p.game_no = last_no) then
      select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t.coins) coins, array_agg(t.team_id) ids into best
      from (select team_id, sum(coins) coins from pool_square_pays where game_id = g.id and team_id is not null group by team_id) t
      join teams tm on tm.id = t.team_id
      where t.coins = (select max(c) from (select sum(coins) c from pool_square_pays where game_id = g.id and team_id is not null group by team_id) z);
      update pool_games set status = 'done', winners = best.ids where id = g.id;
      if best.names is not null then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🏆 %s are done: %s took the most, %s coins.', g.title, best.names, best.coins), jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._squares_tick(text, int) from public, anon, authenticated;

create or replace function public._props_auto(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare a record; x jsonb; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for a in select s.competition from pool_auto_sheets s join competitions c on c.id = s.competition
           where s.league_id = p_league and c.active order by s.competition loop
    for x in select * from jsonb_array_elements(_props_games(a.competition)) loop
      continue when (x->>'kickoff')::timestamptz > now() + interval '36 hours';
      continue when exists (select 1 from pool_games where league_id = p_league and kind = 'props' and (rules->>'fixture')::bigint = (x->>'id')::bigint);
      -- a series' next game only: Game 6 waits until Game 5 is played, so no sheet opens on a game the series may not need
      continue when exists (select 1 from fixtures f join series s on s.id = f.series_id
                            where f.id = (x->>'id')::bigint and s.best_of > 1 and f.game_no > s.high_wins + s.low_wins + 1);
      begin
        perform _pool_game_create('props', a.competition, jsonb_build_object('fixture', (x->>'id')::bigint));
        n := n + 1;
      exception when others then
        raise warning 'automatic sheet on % for league %: %', x->>'id', p_league, sqlerrm;
      end;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._props_auto(int) from public, anon, authenticated;

create or replace function public._props_answers(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures; sp text; reg int; half int; np int; h int; a int; m int; fh int; fa int; hh int; ha int; out jsonb := '{}';
  q jsonb; fin boolean; done1 boolean; doneh boolean; extra boolean;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  if f.id is null or f.state not in ('final', 'live') or f.home_score is null or f.away_score is null then return out; end if;
  fin := f.state = 'final';
  sp := (select sport from competitions where id = f.competition);
  reg := case sp when 'mlb' then 9 when 'nfl' then 4 when 'nba' then 4 else 3 end;
  half := case sp when 'mlb' then 5 else 2 end;
  h := f.home_score; a := f.away_score; m := abs(h - a);
  select count(*), sum(home) filter (where n = 1), sum(away) filter (where n = 1), sum(home) filter (where n <= half), sum(away) filter (where n <= half)
    into np, fh, fa, hh, ha from fixture_periods where fixture_id = f.id;
  -- while the game is on, a period is over once the next has begun (as the squares read it, migration 167)
  done1 := exists (select 1 from fixture_periods where fixture_id = f.id and n > 1 and away is not null);
  doneh := exists (select 1 from fixture_periods where fixture_id = f.id and n > half and away is not null);
  extra := exists (select 1 from fixture_periods where fixture_id = f.id and n > reg and away is not null);
  for q in select * from jsonb_array_elements(g.rules->'questions') loop
    out := out || jsonb_build_object(q->>'key', case when fin then case q->>'key'
      when 'winner' then case when h > a then 'H' when a > h then 'A' end
      when 'total' then case when h + a > (q->>'line')::numeric then 'O' when h + a < (q->>'line')::numeric then 'U' end
      when 'margin' then case when m = 0 then null
        when sp = 'mlb' then case when m = 1 then '1' when m <= 3 then '2' else '4' end
        when sp = 'nfl' then case when m <= 7 then '1' when m <= 14 then '8' else '15' end
        when sp = 'nba' then case when m <= 5 then '1' when m <= 10 then '6' else '11' end
        else case when m = 1 then '1' when m = 2 then '2' else '3' end end
      when 'first' then case when np < 1 or fh is null and fa is null then null
        when coalesce(fh, 0) > coalesce(fa, 0) then 'H' when coalesce(fa, 0) > coalesce(fh, 0) then 'A' else 'T' end
      when 'half' then case when np < half then null
        when coalesce(hh, 0) > coalesce(ha, 0) then 'H' when coalesce(ha, 0) > coalesce(hh, 0) then 'A' else 'T' end
      when 'early' then case when np < 1 then null
        when sp = 'nfl' then case when coalesce(fh, 0) + coalesce(fa, 0) > 9.5 then 'O' else 'U' end
        when sp = 'nba' then case when coalesce(fh, 0) + coalesce(fa, 0) > 54.5 then 'O' else 'U' end
        when coalesce(fh, 0) + coalesce(fa, 0) > 0 then 'Y' else 'N' end
      when 'extra' then case when np < reg then null when np > reg then 'Y' else 'N' end
      when 'shutout' then case when h = 0 or a = 0 then 'Y' else 'N' end
      when 'held' then case when least(h, a) <= case when sp = 'nba' then 99 else 10 end then 'Y' else 'N' end end
    -- under way: only what can no longer change
    else case q->>'key'
      when 'total' then case when h + a > (q->>'line')::numeric then 'O' end
      when 'first' then case when done1 and (fh is not null or fa is not null) then case when coalesce(fh, 0) > coalesce(fa, 0) then 'H' when coalesce(fa, 0) > coalesce(fh, 0) then 'A' else 'T' end end
      when 'half' then case when doneh then case when coalesce(hh, 0) > coalesce(ha, 0) then 'H' when coalesce(ha, 0) > coalesce(hh, 0) then 'A' else 'T' end end
      when 'early' then case
        when sp = 'nfl' then case when coalesce(fh, 0) + coalesce(fa, 0) > 9.5 then 'O' when done1 then 'U' end
        when sp = 'nba' then case when coalesce(fh, 0) + coalesce(fa, 0) > 54.5 then 'O' when done1 then 'U' end
        when coalesce(fh, 0) + coalesce(fa, 0) > 0 then 'Y' when done1 then 'N' end
      when 'extra' then case when extra then 'Y' end
      when 'shutout' then case when h > 0 and a > 0 then 'N' end
      when 'held' then case when least(h, a) > case when sp = 'nba' then 99 else 10 end then 'N' end end end);
  end loop;
  -- a call with no answer yet is a null, as before (at the final, a null is a void call)
  return out;
end $$;
revoke execute on function public._props_answers(bigint) from public, anon, authenticated;
