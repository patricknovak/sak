-- The host's score by hand has a home already (15 October 2026): `pool_result_overrides.home` and `away`, which the
-- survivor's and Call the score's settle by hand (`pool_fixture_result_set`, migration 234) already write and read.
-- Migration 286 added `home_score` and `away_score` beside them for the spread; its readers and `pool_result_set` move
-- onto the existing pair, so either way of settling a match feeds every game on it, and the two columns, never written,
-- go.

create or replace function public._pool_score(p_league int, p_fixture bigint, p_home boolean) returns int
language sql stable security definer set search_path = public as $$
  select case when o.fixture_id is not null then case when p_home then o.home else o.away end
              when p_home then coalesce(f.home_ft, f.home_score) else coalesce(f.away_ft, f.away_score) end
  from fixtures f left join pool_result_overrides o on o.league_id = p_league and o.fixture_id = f.id
  where f.id = p_fixture
$$;
revoke execute on function public._pool_score(int, bigint, boolean) from public, anon, authenticated;

create or replace function public._pickem_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  -- each match as this pool reads it: the host's word (migration 172) before the feed's
  fx as (select f.id, f.gameweek, (o.outcome is null and f.state = 'scheduled' and f.kickoff > now()) open, o.outcome is not null by_host,
           case when o.outcome is not null then o.home else coalesce(f.home_ft, f.home_score) end h,
           case when o.outcome is not null then o.away else coalesce(f.away_ft, f.away_score) end a,
           coalesce(o.outcome = 'void', f.state in ('postponed', 'cancelled')) void,
           case when o.outcome in ('H', 'D', 'A') then o.outcome
                when o.outcome is null and f.state = 'final' then _fixture_result(coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score)) end res
         from fixtures f cross join g left join pool_result_overrides o on o.league_id = g.league_id and o.fixture_id = f.id
         where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int),
  -- each pick's result as it reads it: against the spread, whether its side covered the line it was made at
  pk as (select p.team_id, fx.id, fx.gameweek, fx.void, _pick_res(g.rules, p.pick, fx.res, fx.by_host, fx.h, fx.a) res, p.pick->>'pick' pp,
           case when (select c from conf) then coalesce((p.pick->>'conf')::int, 1) else 1 end w
         from pool_picks p join g on p.game_id = g.id join fx on p.thing = 'f:' || fx.id),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  rn as (select fx.gameweek, count(*)::int n from fx group by fx.gameweek),
  -- each member's matches still open and not picked, round by round
  ou as (select m.id team_id, fx.gameweek, count(*)::int k from members m cross join fx
         where fx.open and not exists (select 1 from pk where pk.team_id = m.id and pk.id = fx.id) group by 1, 2),
  -- in Confidence those matches can still take the highest numbers not yet used that round
  free as (select ou.team_id, ou.k, w.w, row_number() over (partition by ou.team_id, ou.gameweek order by w.w desc) r
           from ou join rn on rn.gameweek = ou.gameweek cross join lateral generate_series(1, rn.n) w(w)
           where not exists (select 1 from pk where pk.team_id = ou.team_id and pk.gameweek = ou.gameweek and pk.w = w.w))
  select m.id::int,
    coalesce((select sum(pk.w) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res), 0)::int,
    (coalesce((select sum(pk.w) from pk where pk.team_id = m.id and ((pk.res is not null and pk.pp = pk.res) or (pk.res is null and not pk.void))), 0)
      + case when (select c from conf) then coalesce((select sum(f.w) from free f where f.team_id = m.id and f.r <= f.k), 0)
             else coalesce((select sum(ou.k) from ou where ou.team_id = m.id), 0) end)::int,
    (select count(*) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res)::int,
    0,
    (select count(*) from pk where pk.team_id = m.id)::int,
    -- the tiebreaker: how far off the total in the last game of the latest round played (lower is better)
    _pickem_miss(p_game, m.id, (select _pickem_tb_round(p_game)))
  from members m
$$;

create or replace function public.pool_result_set(p_game bigint, p_fixture bigint, p_outcome text, p_reason text default null,
                                                  p_home int default null, p_away int default null) returns text
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; v text := upper(nullif(trim(p_outcome), '')); hn text; an text; ats boolean;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.kind <> 'pickem' then raise exception 'Results by hand are for pick''em matches'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  select * into f from fixtures where id = p_fixture and competition = g.competition
    and gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int;
  if f.id is null then raise exception 'That match isn''t in this game'; end if;
  if f.state = 'scheduled' and f.kickoff > now() then raise exception 'That match hasn''t kicked off yet'; end if;
  if v is null then
    delete from pool_result_overrides where league_id = current_league_id() and fixture_id = f.id;
    return null;
  end if;
  if v not in ('H', 'D', 'A', 'VOID') then raise exception 'Settle it as a home win, an away win, a draw, or void'; end if;
  if v = 'D' and not coalesce((g.rules->>'draws')::boolean, false) then raise exception 'There are no draws in this sport'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, so the pool can see it'; end if;
  v := case when v = 'VOID' then 'void' else v end;
  ats := g.rules->>'ats' = 'true';
  if (p_home is null) <> (p_away is null) or p_home < 0 or p_away < 0 then raise exception 'Give both scores'; end if;
  if v = 'void' then p_home := null; p_away := null; end if;
  if ats and v <> 'void' and p_home is null then raise exception 'Against the spread every pick is scored on its own line: give the final score'; end if;
  if p_home is not null and _fixture_result(p_home, p_away) <> v then raise exception 'That score doesn''t match the result'; end if;
  insert into pool_result_overrides (fixture_id, outcome, reason, by_team, home, away)
  values (f.id, v, left(trim(p_reason), 200), my_team(), p_home, p_away)
  on conflict (league_id, fixture_id) do update set outcome = excluded.outcome, reason = excluded.reason, by_team = excluded.by_team,
    home = excluded.home, away = excluded.away, at = now();
  select name into hn from clubs where id = f.home_club;
  select name into an from clubs where id = f.away_club;
  perform _sys('general', format('📝 The host settled %s v %s in %s: %s. %s', hn, an, g.title,
    case v when 'H' then hn || ' win' when 'A' then an || ' win' when 'D' then 'a draw' else 'void, it counts for nobody' end
      || case when p_home is not null then format(', %s-%s', p_home, p_away) else '' end, left(trim(p_reason), 200)),
    jsonb_build_object('pool_game', g.id, 'fixture', f.id));
  perform _pickem_round(g.id, f.gameweek);
  return v;
end $$;

alter table public.pool_result_overrides drop column if exists home_score;
alter table public.pool_result_overrides drop column if exists away_score;
