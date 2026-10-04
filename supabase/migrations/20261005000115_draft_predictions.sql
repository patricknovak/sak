-- Drafts and keepers join the prediction log (docs/DEVELOPMENT.md, section 4: "next kinds: draft and keeper grades").
--
-- When a league's draft is done, each team gets two predictions: 'draft_value', the points its draft class is
-- expected to score over the regular season, and 'keeper_value', the same for the players it kept (each player's
-- per-game rate times his club's games left, _players_left, the trade log's measure). At the end of the regular
-- season score_predictions fills in what those players actually scored from the day after the draft, so every
-- league learns how its drafts and keepers were valued against how they played. A trigger on the draft finishing
-- writes them, so every path to a finished draft logs it; a league with no season end set logs nothing.

set client_min_messages = warning;

create or replace function public._predict_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev text := current_setting('app.league_id', true); d date; se date; t int; drafted int[]; kept int[];
begin
  if new.status <> 'done' or old.status = 'done' then return new; end if;
  perform set_config('app.league_id', new.league_id::text, true);
  d := today_et();
  select season_end into se from league_rules where league_id = new.league_id;
  if se is not null and se > d then
    for t in select id from teams where league_id = new.league_id and role = 'gm' order by id loop
      select coalesce(array_agg(player_id order by overall), '{}') into drafted
      from draft_picks where league_id = new.league_id and season = new.season and team_id = t and player_id is not null;
      select coalesce(array_agg(player_id order by player_id), '{}') into kept
      from rosters where team_id = t and acquired = 'keeper';
      if cardinality(drafted) > 0 then
        insert into predictions (league_id, kind, subject, predicted, basis, resolves_on)
        values (new.league_id, 'draft_value', jsonb_build_object('team_id', t, 'season', new.season, 'players', to_jsonb(drafted), 'from', d + 1),
          round(_players_left(drafted, d + 1, se), 1), 'season rate x games left', se)
        on conflict (league_id, kind, subject) do nothing;
      end if;
      if cardinality(kept) > 0 then
        insert into predictions (league_id, kind, subject, predicted, basis, resolves_on)
        values (new.league_id, 'keeper_value', jsonb_build_object('team_id', t, 'season', new.season, 'players', to_jsonb(kept), 'from', d + 1),
          round(_players_left(kept, d + 1, se), 1), 'season rate x games left', se)
        on conflict (league_id, kind, subject) do nothing;
      end if;
    end loop;
  end if;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return new;
end $$;
revoke execute on function public._predict_draft() from public, anon, authenticated;

create or replace trigger draft_state_predict after update of status on public.draft_state
  for each row execute function public._predict_draft();

create or replace function public.score_predictions(p_through date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); through date := coalesce(p_through, today_et() - 1); n int := 0; k int;
begin
  -- a player who dressed: his points that night in this league's scoring
  with done as (
    select pr.id, sum(lg.fpts) as pts
    from predictions pr
    join league_games lg on lg.player_id = (pr.subject->>'player_id')::int and lg.date = (pr.subject->>'date')::date
    join games g on g.id = lg.game_id and g.final_synced
    where pr.league_id = lid and pr.kind = 'player_night' and pr.status = 'open' and pr.resolves_on <= through
    group by pr.id)
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  -- a player who never dressed once his club's games that night are final: void, not a zero
  update predictions pr set status = 'void', scored_at = now()
  where pr.league_id = lid and pr.kind = 'player_night' and pr.status = 'open' and pr.resolves_on <= through
    and not exists (select 1 from games g join players p on p.id = (pr.subject->>'player_id')::int
                    where g.date = (pr.subject->>'date')::date and p.nhl_team in (g.home, g.away) and not g.final_synced
                      and g.state not in ('PPD', 'CNCL'));
  get diagnostics k = row_count; n := n + k;
  -- a trade, once the regular season it was valued over is done: what the players coming in scored from the day
  -- after it went through, less what the players going out scored, in this league's points
  with done as (
    select pr.id,
      coalesce((select sum(lg.fpts) from league_games lg where lg.player_id in (select jsonb_array_elements_text(pr.subject->'in')::int)
                  and lg.date between (pr.subject->>'from')::date and pr.resolves_on), 0)
      - coalesce((select sum(lg.fpts) from league_games lg where lg.player_id in (select jsonb_array_elements_text(pr.subject->'out')::int)
                  and lg.date between (pr.subject->>'from')::date and pr.resolves_on), 0) as pts
    from predictions pr
    where pr.league_id = lid and pr.kind = 'trade_value' and pr.status = 'open' and pr.resolves_on <= through)
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  -- a draft class or a team's keepers, once the regular season is done: what those players scored from the day after
  -- the draft, in this league's points, whoever they played for by then (the grade is of the picks, not the moves after)
  with done as (
    select pr.id,
      coalesce((select sum(lg.fpts) from league_games lg where lg.player_id in (select jsonb_array_elements_text(pr.subject->'players')::int)
                  and lg.date between (pr.subject->>'from')::date and pr.resolves_on), 0) as pts
    from predictions pr
    where pr.league_id = lid and pr.kind in ('draft_value', 'keeper_value') and pr.status = 'open' and pr.resolves_on <= through)
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
