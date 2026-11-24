-- The second pass of the bug hunt of 24 November 2026.
--
-- 1. A finished pool game with nobody on the board broke its own page. pool_game_chances, like _pool_win_score
--    before migration 364, divided by the number of winners; with winners = '{}' Postgres works the division out
--    while planning, before it sees there are no rows to read, and the pool's table asked for chances and got an
--    error. No game on live is in that state today; the MLS pick'em that migration 364 lets finish will be the first.
--
-- 2. A member could vote in a poll as someone else. The policy that lets a member change their vote checked the row
--    before the change (it is yours) and the poll after it (it is open), but not whose the vote is afterwards: an
--    update could hand your vote to another team and leave you free to vote again, once for every member. The vote
--    stays yours.
--
-- 3. A poll's author could rewrite it after the votes were in. The site only ever closes a poll, but the table let
--    its author (or the commissioner) change the question, the answers, the closing time, or open it again. Closing
--    is now the one change there is.
--
-- 4. A member could date a chat message as they liked. The table let a post carry its own id, created_at, edited_at
--    and removed flag, so a message could be written into last week ("called it") or into next year, where it would
--    sit newest in the feed for good. A post now carries what the composer sends (where, who, the words, what it
--    answers, its meta) and the database stamps the rest; the row-level rule on who may post where is unchanged.

create or replace function public.pool_game_chances(p_game bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare g pool_games; out jsonb; last date;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then return '[]'; end if;
  if g.status = 'done' then
    return coalesce((select jsonb_agg(jsonb_build_object('team_id', w, 'chance', round(1.0 / nullif(cardinality(g.winners), 0), 3))) from unnest(g.winners) w), '[]');
  end if;
  if g.kind = 'pickem' then
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _pickem_chances(p_game) c;
    -- the forecast resolves with the game's last match
    last := (select max(f.date) from fixtures f where f.competition = g.competition and f.gameweek <= (g.rules->>'to_round')::int);
  elsif g.kind = 'series' then
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _series_chances(p_game) c;
    -- with the last series' last scheduled game, or in a month if its games aren't drawn yet
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  elsif g.kind = 'bracket' then
    -- a bracket is the member's to change until it locks
    if coalesce(_rank_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _bracket_chances(p_game) c;
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  elsif g.kind = 'players' then
    -- a team is the member's to change until the first face-off (the opening puck)
    if coalesce(_players_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _players_chances(p_game) c;
    last := (g.rules->>'to')::date + 1;
  elsif g.kind = 'rank' then
    -- the order is the member's to change until the lock; after it, the wins decide
    if coalesce(_rank_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _rank_chances(p_game) c;
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  elsif g.kind = 'props' then
    -- a sheet is the member's to change until the game starts (migration 218)
    if not exists (select 1 from fixtures f where f.id = (g.rules->>'fixture')::bigint and (f.state <> 'scheduled' or f.kickoff <= now())) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _props_chances(p_game) c;
    last := (select f.date from fixtures f where f.id = (g.rules->>'fixture')::bigint);
  elsif g.kind = 'wins' then
    -- the calls are the member's to change until the opener (migration 298)
    if coalesce(_wins_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _wins_chances(p_game) c;
    last := (select max(f.date) from fixtures f where f.competition = g.competition);
  else
    return '[]';
  end if;
  -- the forecast, once a day per member
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail)
  select g.league_id, 'pool_win', jsonb_build_object('game', g.id, 'team_id', (e->>'team_id')::int, 'date', today_et()),
    (e->>'chance')::numeric, g.kind, coalesce(last, today_et()), jsonb_build_object('members', jsonb_array_length(out))
  from jsonb_array_elements(coalesce(out, '[]')) e
  on conflict (league_id, kind, subject) do nothing;
  return coalesce(out, '[]');
end $$;


-- the vote stays the voter's own (the using clause and the rest of the check are as they were)
alter policy revote_own on public.poll_votes
  with check (league_id = (select current_league_id()) and team_id = my_team()
    and exists (select 1 from polls p where p.id = poll_votes.poll_id and not p.closed and (p.closes_at is null or p.closes_at > now())));

-- a poll is closed by its author or the commissioner, and that is all either can change
alter policy close_own on public.polls
  with check (league_id = (select current_league_id()) and (team_id = my_team() or is_commish()) and closed);
revoke update on public.polls from authenticated;
grant update (closed) on public.polls to authenticated;

-- a post carries the composer's fields; its id and its times are the database's
revoke insert on public.messages from authenticated;
grant insert (channel, team_id, body, reply_to, meta, kind, league_id) on public.messages to authenticated;
