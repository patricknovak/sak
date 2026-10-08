-- Pick reminders in every sport's words, and a last call for last one standing (docs/DEVELOPMENT.md §6): the reminder
-- six hours before a round's first kick-off said "Matchweek" and "club" whatever the sport, and stayed quiet once any
-- match of the round had started. The NFL's week opens on a Thursday, so a survivor player who hadn't picked by then
-- heard nothing before Sunday. Now the words are the sport's, and a survivor round already under way gets one last call
-- six hours before its final kick-off for anyone still in without a pick (no pick and they're out).

create or replace function public._soccer_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g record; t record; n int := 0; gw int; first_ko timestamptz; last_ko timestamptz; total int; called int; hrs text; w text; club text; started boolean; last_call boolean;
begin
  for g in select 'predictor' game, id, competition, status from predictors where league_id = p_league and status = 'open'
           union all select 'survivor', id, competition, status from survivors where league_id = p_league and status = 'open' loop
    gw := case when g.game = 'predictor' then _predictor_week(g.id) else _survivor_week(g.id) end;
    if gw is null then continue; end if;
    select min(kickoff), max(kickoff), count(*) into first_ko, last_ko, total from fixtures where competition = g.competition and gameweek = gw and state = 'scheduled' and kickoff > now();
    if first_ko is null then continue; end if;
    w := _round_word(g.competition); club := _sport_word(g.competition, 'club', 'club');
    started := exists (select 1 from fixtures where competition = g.competition and gameweek = gw and kickoff <= now());
    -- the round's first kick-off six hours out; for last one standing, a round already under way (the NFL's Thursday
    -- game) gets a last call six hours before its final kick-off instead, for anyone still without a pick
    last_call := g.game = 'survivor' and started;
    if last_call then
      if last_ko > now() + interval '6 hours' then continue; end if;
      first_ko := last_ko;
    elsif started or first_ko > now() + interval '6 hours' then continue;
    end if;
    hrs := case when first_ko - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from first_ko - now()) / 3600))::int || 'h' end;
    for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
               -- a last call is kept apart from the first reminder (its round as a negative number)
               and not exists (select 1 from private.soccer_nudged x where x.game = g.game and x.game_id = g.id and x.team_id = tm.id
                               and x.gameweek = case when last_call then -gw else gw end) loop
      if g.game = 'predictor' then
        called := (select count(*) from predictor_picks where predictor_id = g.id and team_id = t.id and gameweek = gw);
        if called >= total then continue; end if;
        perform _pool_alert(t.id, 'predictor', format('⏰ %s %s kicks off in %s. %s', w, gw, hrs,
          case when called = 0 then format('Call the score: %s matches to call.', total) else format('You have %s of %s matches still to call.', total - called, total) end), '/predictor');
      else
        if not _survivor_alive(g.id, t.id) or exists (select 1 from survivor_picks where survivor_id = g.id and team_id = t.id and gameweek = gw) then continue; end if;
        perform _pool_alert(t.id, 'survivor', case when last_call
          then format('⏰ Last call for %s %s: its last %s kicks off in %s. Pick your %s or you''re out.', lower(w), gw, _sport_word(g.competition, 'match', 'match'), hrs, club)
          else format('⏰ %s %s kicks off in %s. Pick your %s to stay in.', w, gw, hrs, club) end, '/survivor');
      end if;
      insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.game, g.id, t.id, case when last_call then -gw else gw end) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._soccer_nudge(int) from public, anon, authenticated;
