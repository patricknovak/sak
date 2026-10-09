-- Fixes from an independent review of migrations 224 to 228. Safe to run twice.
--  * The live "early" and "half" calls wait for those periods' scores, as the 1st period's does (migration 225).
--  * Two sheets opened on one game at the same moment (the host and the hourly job) get the plain "already runs that
--    game" rather than the table's unique-index error.

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
      when 'half' then case when doneh and (hh is not null or ha is not null) then case when coalesce(hh, 0) > coalesce(ha, 0) then 'H' when coalesce(ha, 0) > coalesce(hh, 0) then 'A' else 'T' end end
      when 'early' then case
        when sp = 'nfl' then case when coalesce(fh, 0) + coalesce(fa, 0) > 9.5 then 'O' when done1 and (fh is not null or fa is not null) then 'U' end
        when sp = 'nba' then case when coalesce(fh, 0) + coalesce(fa, 0) > 54.5 then 'O' when done1 and (fh is not null or fa is not null) then 'U' end
        when coalesce(fh, 0) + coalesce(fa, 0) > 0 then 'Y' when done1 and (fh is not null or fa is not null) then 'N' end
      when 'extra' then case when extra then 'Y' end
      when 'shutout' then case when h > 0 and a > 0 then 'N' end
      when 'held' then case when least(h, a) > case when sp = 'nba' then 99 else 10 end then 'N' end end end);
  end loop;
  -- a call with no answer yet is a null, as before (at the final, a null is a void call)
  return out;
end $$;
revoke execute on function public._props_answers(bigint) from public, anon, authenticated;

create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions; s series;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  -- one game of each kind on an event; squares, one grid on each series or week's game
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open'
             and (p_kind <> 'squares' or coalesce(rules->>'series', 'f' || (rules->>'fixture')) = coalesce(r->>'series', 'f' || (r->>'fixture'))) and (p_kind <> 'props' or rules->>'fixture' = r->>'fixture')
             -- a second bracket goes on from a later round, once the first has locked
             and (p_kind <> 'bracket' or rules->>'from_round' = r->>'from_round' or not _pool_game_locked(id))) then
    raise exception 'This pool already runs that game';
  end if;
  if p_kind = 'squares' then
    if r ? 'fixture' then
      -- a week's game is a series of one: 'Week 6: DAL at PHI squares'
      select format('%s: %s at %s squares', coalesce(nullif(f.round, ''), _round_word(p_competition) || ' ' || f.gameweek), coalesce(ca.short, ca.name), coalesce(ch.short, ch.name))
        into ttl from fixtures f join clubs ca on ca.id = f.away_club join clubs ch on ch.id = f.home_club where f.id = (r->>'fixture')::bigint;
      s.best_of := 1;
    else
      select * into s from series where id = (r->>'series')::bigint;
      ttl := s.label || ' squares';
    end if;
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🔲 %s are open: %s coins a square, %s. The digits are drawn when the grid fills or at %s, and the pot pays %s.',
      ttl, r->>'cost', case when (r->>'size')::int = 10 then '100 squares' else '25 squares with two digits a side' end,
      case when s.best_of > 1 then format('the %s of Game 1', _sport_word(p_competition, 'start', 'first pitch')) else _sport_word(p_competition, 'start', 'first pitch') end,
      case r->>'pays' when 'innings' then 'after the 3rd, the 6th and the final of every game'
        when 'quarters' then 'after the 1st quarter, at the half, after the 3rd quarter and on the final' || case when s.best_of > 1 then ' of every game' else '' end
        when 'periods' then 'after the 1st period, the 2nd and the final' || case when s.best_of > 1 then ' of every game' else '' end
        else 'the final score' || case when s.best_of > 1 then ' of every game' else '' end end),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'props' then
    select coalesce(x.short, x.label, nullif(f.round, ''), 'Week ' || f.gameweek) || case when x.best_of > 1 then ' Game ' || f.game_no else '' end
        || ': ' || coalesce(ca.short, ca.name) || ' at ' || coalesce(ch.short, ch.name)
      into ttl from fixtures f left join series x on x.id = f.series_id join clubs ca on ca.id = f.away_club join clubs ch on ch.id = f.home_club
      where f.id = (r->>'fixture')::bigint;
    ttl := 'Props · ' || ttl;
    begin
      insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    exception when unique_violation then
      raise exception 'This pool already runs that game';
    end;
    perform _sys('general', format('📋 The prop sheet is open on %s: %s calls on the game, a point each, and the total breaks a tie. It locks at the %s.',
      substr(ttl, 9), jsonb_array_length(r->'questions'), _sport_word(p_competition, 'start', 'start')), jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'players' then
    ttl := 'The box pool';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', case when coalesce((r->>'playoffs')::boolean, false)
      then format('🏒 The playoff box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, all the way to the Cup. Your team locks at the first puck drop.',
        jsonb_array_length(r->'boxes'))
      else format('🏒 The box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, from %s to %s. Your team locks at the first puck drop.',
        jsonb_array_length(r->'boxes'), to_char((r->>'from')::date, 'FMDay FMMonth FMDD'), to_char((r->>'to')::date, 'FMDay FMMonth FMDD')) end,
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'pickem' then
    ttl := c.name || ' pick''em';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('✅ %s is on from %s %s: pick the winner of every match%s. Each pick locks at its %s.%s',
      ttl, _round_word(p_competition), r->>'from_round', case when (r->>'draws')::boolean then ', or a draw' else '' end,
      coalesce((select sp.config->'words'->>'start' from sports sp where sp.id = c.sport), 'start'),
      case when r->>'preset' = 'confidence' then ' Number each round''s picks by confidence too: your surest is worth the most.' else '' end),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  fr_label := (select regexp_replace(min(label), '^(AL|NL|AFC|NFC) ', '') from series where competition = p_competition and round = (r->>'from_round')::int);
  ttl := case p_kind when 'series' then 'Pick the series'
    when 'bracket' then case when exists (select 1 from pool_games where league_id = current_league_id() and kind = 'bracket' and competition = p_competition
                                           and (rules->>'from_round')::int < (r->>'from_round')::int) then 'Second-chance bracket' else 'The bracket' end
    else 'Rank the teams' end;
  insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
  perform _sys('general', case p_kind
    when 'series' then format('⚔️ Pick the series is on, from the %s: call each series%s. Each pick locks at its %s.', fr_label,
      case when (select max(best_of) from series where competition = p_competition) > 1 then ' and how many games it goes' else '' end,
      case when (select max(best_of) from series where competition = p_competition) > 1 then 'Game 1''s ' else 'game''s ' end || _sport_word(p_competition, 'start', 'start'))
    when 'bracket' then case when ttl = 'Second-chance bracket'
      then format('🏆 The second-chance bracket is open, from the %s: a fresh bracket for everyone, busted or not. Pick every winner to the final before its first game.', fr_label)
      else format('🏆 The bracket is open, from the %s: pick the winner of every series through to the final, all before the first game. Later rounds are worth more.', fr_label) end
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first %s of the round.', fr_label, _sport_word(p_competition, 'start', 'start')) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
revoke execute on function public._pool_game_create(text, text, jsonb) from public, anon, authenticated;
