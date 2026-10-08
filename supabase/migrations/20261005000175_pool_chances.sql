-- What you need to win (docs/DEVELOPMENT.md §6 item 6), pick'em first: each member's chance of finishing first, played
-- out by simulation over the matches still to be decided.
--
-- * Every match not yet decided is drawn many times from the pool's own split on it, smoothed so a side nobody picked
--   still has a chance (a pool that all picked the home side doesn't make the home side certain). A match a member
--   hasn't picked yet counts as a guess: right one time in two, or in three where the sport has draws, at the round's
--   average Confidence number.
-- * Each run adds what each member's picks earn to the points they have; whoever has the most wins that run (a tie
--   shares it). The chance is the share of runs won. A game that is over is certain: its winners.
-- * The chances are a forecast, so the product learns from them: the first look each day writes each member's to the
--   prediction log (`pool_win`), scored when the game ends (1 for a winner, shared on a tie, 0 for the rest).

create or replace function public._pickem_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'pickem'),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  k as (select case when coalesce((select (sp.config->>'draws')::boolean from g join competitions c on c.id = g.competition join sports sp on sp.id = c.sport), false)
                    then 3 else 2 end n),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  pts as (select m.id, coalesce(t.points, 0) points from members m left join _pickem_table(p_game) t on t.team_id = m.id),
  -- the matches still to be decided, and each round's size (for the average Confidence number)
  fx as (select f.id, f.gameweek, x.open from g join fixtures f on f.competition = g.competition
           cross join lateral _pool_fixture(g.league_id, f.id) x
         where f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int and not x.done),
  rs as (select f.gameweek, count(*) n from g join fixtures f on f.competition = g.competition
         where f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int group by 1),
  pk as (select p.team_id, fx.id fid, p.pick->>'pick' side,
           case when (select c from conf) then coalesce((p.pick->>'conf')::int, 1) else 1 end w
         from pool_picks p join g on p.game_id = g.id join fx on p.thing = 'f:' || fx.id),
  -- each match's chances: the pool's split with one more pick on every side
  pr as (select fx.id fid,
           (count(pk.side) filter (where pk.side = 'H') + 1.0) / (count(pk.side) + (select n from k)) ph,
           case when (select n from k) = 3 then (count(pk.side) filter (where pk.side = 'D') + 1.0) / (count(pk.side) + 3) else 0 end pd
         from fx left join pk on pk.fid = fx.id group by fx.id),
  -- a member's open matches with no pick yet: a guess
  un as (select m.id team_id, case when (select c from conf) then (rs.n + 1) / 2.0 else 1 end w
         from members m cross join fx join rs on rs.gameweek = fx.gameweek
         where fx.open and not exists (select 1 from pk where pk.team_id = m.id and pk.fid = fx.id)),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  outcome as (select r.s, pr.fid, case when x.u < pr.ph then 'H' when x.u < pr.ph + pr.pd then 'D' else 'A' end res
              from runs r cross join pr cross join lateral (select random() + 0 * r.s u) x),
  gain as (select o.s, pk.team_id, sum(pk.w) w from outcome o join pk on pk.fid = o.fid and pk.side = o.res group by 1, 2),
  -- up to twenty open matches, each guess drawn; beyond that (a season still to play), the sum of the guesses is
  -- drawn whole from its normal shape (mean and spread of that many coin flips), which keeps a long season quick
  uc as (select team_id, count(*) n, sum(w) sw, sum(w * w) sw2 from un group by 1),
  guess as (select r.s, un.team_id, sum(un.w) filter (where random() + 0 * r.s < 1.0 / (select n from k)) w
            from runs r cross join un join uc on uc.team_id = un.team_id and uc.n <= 20 group by 1, 2
            union all
            select r.s, uc.team_id, greatest(0, uc.sw / kk.n + sqrt(uc.sw2 * (1.0 / kk.n) * (1 - 1.0 / kk.n))
                                                  * sqrt(-2 * ln(1 - random() + 0 * r.s)) * cos(2 * pi() * random()))
            from runs r cross join uc cross join k kk where uc.n > 20),
  total as (select r.s, p.id team_id, p.points + coalesce(ga.w, 0) + coalesce(gu.w, 0) t
            from runs r cross join pts p
            left join gain ga on ga.s = r.s and ga.team_id = p.id
            left join guess gu on gu.s = r.s and gu.team_id = p.id),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t)
  select p.id, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from pts p left join won w on w.team_id = p.id group by p.id
$$;
revoke execute on function public._pickem_chances(bigint, int) from public, anon, authenticated;

-- a member's chances in a game, for the Table: [{team_id, chance}]; an open pick'em is simulated, a game that's over
-- is its winners, any other kind says nothing yet. The first look each day logs them.
create or replace function public.pool_game_chances(p_game bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare g pool_games; out jsonb; last date;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then return '[]'; end if;
  if g.status = 'done' then
    return coalesce((select jsonb_agg(jsonb_build_object('team_id', w, 'chance', round(1.0 / cardinality(g.winners), 3))) from unnest(g.winners) w), '[]');
  end if;
  if g.kind <> 'pickem' then return '[]'; end if;
  select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _pickem_chances(p_game) c;
  -- the forecast, once a day per member, resolving with the game's last match
  last := (select max(f.date) from fixtures f where f.competition = g.competition and f.gameweek <= (g.rules->>'to_round')::int);
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail)
  select g.league_id, 'pool_win', jsonb_build_object('game', g.id, 'team_id', (e->>'team_id')::int, 'date', today_et()),
    (e->>'chance')::numeric, 'pickem', coalesce(last, today_et()), jsonb_build_object('members', jsonb_array_length(out))
  from jsonb_array_elements(coalesce(out, '[]')) e
  on conflict (league_id, kind, subject) do nothing;
  return coalesce(out, '[]');
end $$;
revoke execute on function public.pool_game_chances(bigint) from public, anon;
grant execute on function public.pool_game_chances(bigint) to authenticated;

-- the game ends: its chances are scored (a winner 1, shared on a tie; the rest 0)
create or replace function public._pool_win_score() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    update predictions pr set
      outcome = case when (pr.subject->>'team_id')::int = any (coalesce(new.winners, '{}')) then round(1.0 / cardinality(new.winners), 3) else 0 end,
      error = case when (pr.subject->>'team_id')::int = any (coalesce(new.winners, '{}')) then round(1.0 / cardinality(new.winners), 3) else 0 end - pr.predicted,
      status = case when coalesce(cardinality(new.winners), 0) = 0 then 'void' else 'scored' end, scored_at = now()
    where pr.league_id = new.league_id and pr.kind = 'pool_win' and pr.status = 'open' and (pr.subject->>'game')::bigint = new.id;
  end if;
  return new;
end $$;
revoke execute on function public._pool_win_score() from public, anon, authenticated;
drop trigger if exists pool_games_win_score on public.pool_games;
create trigger pool_games_win_score after update of status on public.pool_games
  for each row execute function public._pool_win_score();
