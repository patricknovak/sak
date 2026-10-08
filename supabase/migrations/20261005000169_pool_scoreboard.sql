-- The pool scoreboard (docs/POOL-TYPES.md §3 and §6): one table over every game a pool runs, whatever its kind. Each
-- engine keeps its own rules and its own board (the questions' net worth, pick the series, rank the teams, squares,
-- last one standing, call the score); this reads them all into one shape, so what every pool needs is built once:
--
-- * `_pool_rows()`, the adapter: one row per member per game, with a score, the most still possible, whether they're
--   still in, a tiebreak (lower is better) and a line of detail. A new kind of game adds its branch here and gets the
--   rest for free.
-- * `pool_scoreboard()`: every game ranked, the pool's main game first, with each member's movement since the day began
--   and the caller's place in each.
-- * The main game (`league_rules.crown`): the one whose table the pool's home shows and whose winner wears the crown.
--   The host names it; until then it's the first game still open, in the order a pool usually cares about.
-- * `pool_standing`: where each member stood at the last look and at the start of the day. The hourly pool job
--   (`run_pool_drops`) moves it on and tells a member who climbed into first, or three places or more (once a game a
--   day, open games only, three members or more).

-- ───────────── the main game ─────────────
alter table public.league_rules add column if not exists crown text;

-- ───────────── where everyone stood ─────────────
create table if not exists public.pool_standing (
  league_id int not null default current_league_id() references public.leagues (id),
  game text not null,                             -- 'questions', 'game:<id>', 'survivor:<id>', 'predictor:<id>'
  team_id int not null references public.teams (id) on delete cascade,
  rank int not null,
  score numeric not null default 0,
  day_rank int not null,                          -- the rank the day began with: the arrows count from it
  day date not null,
  alerted date,                                   -- the last day this member heard they climbed in this game
  updated_at timestamptz not null default now(),
  primary key (league_id, game, team_id)
);

do $$ begin
  alter table public.pool_standing enable row level security;
  if not exists (select 1 from pg_policy where polrelid = 'public.pool_standing'::regclass and polname = 'league_read') then
    create policy league_read on public.pool_standing for select to authenticated using (league_id = (select current_league_id()));
  end if;
  -- read through the scoreboard only
  revoke all on public.pool_standing from anon, authenticated;
  grant all on public.pool_standing to service_role;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pool_standing'::regclass and tgname = 'pool_standing_stamp_league') then
    create trigger pool_standing_stamp_league before insert on public.pool_standing for each row execute function public._stamp_league();
  end if;
end $$;

-- ───────────── the adapter ─────────────
-- Every game in the caller's pool, one row per member. `score` ranks highest first; `alive` (when a game has it) ranks
-- those still in above those out; `tiebreak` ranks lowest first. `possible` is the most a member can still finish
-- with, where the game can say.
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
  for g in select * from pool_games pg where pg.league_id = lid order by pg.id loop
    return query
    select 'game:' || g.id, g.kind, g.title, g.status, '/picks?g=' || g.id, t.team_id, t.points::numeric,
      case when g.kind = 'squares' then null else t.possible::numeric end, null::boolean, t.tiebreak::numeric,
      case g.kind
        when 'series' then case when t.right_calls > 0 then format('%s right, %s with the length', t.right_calls, t.exact)
                                when t.picked > 0 then format('%s series picked', t.picked) else 'Nothing picked yet' end
        when 'squares' then case when t.picked > 0 then format('%s square%s', t.picked, case when t.picked = 1 then '' else 's' end) else 'No squares' end
        else case when t.picked > 0 then 'Ranked' else 'Not ranked yet' end end
    from _pool_game_table(g.id) t;
  end loop;

  -- last one standing: still in (or the winner, once it's over) first, then the matchweeks survived, then who went out
  -- latest
  for g in select * from survivors s where s.league_id = lid order by s.id loop
    return query
    select 'survivor:' || g.id, 'survivor'::text, 'Last one standing'::text, g.status, '/survivor'::text, x.id,
      x.through::numeric, null::numeric, x.alive, (-coalesce(x.out_gw, 0))::numeric,
      case when g.status = 'done' and x.alive then 'Won it' when x.alive then 'Still in'
           when x.out_gw is not null then format('Out in matchweek %s', x.out_gw) else 'Out' end
    from (select tm.id,
            case when g.status = 'done' then tm.id = any(coalesce(g.winners, '{}')) else _survivor_alive(g.id, tm.id) end alive,
            (select count(*) from survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result = 'through')::int through,
            (select min(p.gameweek) from survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result in ('out', 'missed')) out_gw
          from teams tm where tm.league_id = lid and tm.role = 'gm') x;
  end loop;

  -- call the score: points, then exact scores
  for g in select * from predictors s where s.league_id = lid order by s.id loop
    return query
    select 'predictor:' || g.id, 'score'::text, 'Call the score'::text, g.status, '/predictor'::text, x.id,
      x.pts::numeric, null::numeric, null::boolean, (-x.ex)::numeric,
      case when x.rt > 0 then format('%s exact, %s right', x.ex, x.rt) else 'No points yet' end
    from (select tm.id, coalesce(sum(p.points), 0)::int pts,
            count(*) filter (where p.points > 0 and p.home = coalesce(f.home_ft, f.home_score) and p.away = coalesce(f.away_ft, f.away_score))::int ex,
            count(*) filter (where p.points > 0)::int rt
          from teams tm
          left join predictor_picks p on p.predictor_id = g.id and p.team_id = tm.id
          left join fixtures f on f.id = p.fixture_id
          where tm.league_id = lid and tm.role = 'gm'
          group by tm.id) x;
  end loop;
end $$;
revoke execute on function public._pool_rows() from public, anon, authenticated;

-- every row ranked within its game (ties share a place)
create or replace function public._pool_ranked()
returns table (game text, kind text, title text, status text, link text, team_id int, rank int, score numeric, possible numeric, alive boolean, line text, members int)
language sql stable security definer set search_path = public as $$
  select r.game, r.kind, r.title, r.status, r.link, r.team_id,
    (rank() over (partition by r.game order by r.alive desc nulls last, r.score desc, r.tiebreak asc nulls last))::int,
    r.score, r.possible, r.alive, r.line, (count(*) over (partition by r.game))::int
  from _pool_rows() r
$$;
revoke execute on function public._pool_ranked() from public, anon, authenticated;

-- the main game: the host's choice while it still exists, else the first open game in the order a pool usually cares
-- about (a sports game, call the score, last one standing, the questions), else the first game of any kind
create or replace function public._pool_crown() returns text
language sql stable security definer set search_path = public as $$
  with games as (select distinct r.game, r.kind, r.status from _pool_rows() r),
  pick as (select (select crown from league_rules where league_id = current_league_id()) c)
  select coalesce(
    (select p.c from pick p where exists (select 1 from games g where g.game = p.c)),
    (select g.game from games g order by g.status = 'open' desc,
       case when g.game like 'game:%' then 0 when g.kind = 'score' then 1 when g.kind = 'survivor' then 2 else 3 end,
       nullif(regexp_replace(g.game, '\D', '', 'g'), '')::bigint nulls first limit 1))
$$;
revoke execute on function public._pool_crown() from public, anon, authenticated;

-- ───────────── reading ─────────────
-- the pool's scoreboard: every game with its table, the main game first, open games before finished ones; each row
-- carries the member's movement since the day began (up is positive) and the caller's own place in each game
create or replace function public.pool_scoreboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lid int := current_league_id(); me int := my_team(); top text;
begin
  if lid is null then return null; end if;
  top := _pool_crown();
  return jsonb_build_object('crown', top, 'games', coalesce((
    with rk as materialized (
      select q.*, s.day_rank - q.rank move, t.gm_name, max(q.score) over (partition by q.game) best
      from _pool_ranked() q join teams t on t.id = q.team_id
      left join pool_standing s on s.league_id = lid and s.game = q.game and s.team_id = q.team_id),
    g as (
      select rk.game, min(rk.status) status, jsonb_build_object(
        'key', rk.game, 'kind', min(rk.kind), 'title', min(rk.title), 'status', min(rk.status), 'link', min(rk.link),
        'members', max(rk.members), 'crown', rk.game = top,
        'mine', (select jsonb_build_object('rank', m.rank, 'score', m.score, 'possible', m.possible, 'alive', m.alive, 'line', m.line,
                   'move', m.move, 'behind', m.best - m.score) from rk m where m.game = rk.game and m.team_id = me),
        'rows', jsonb_agg(jsonb_build_object('team_id', rk.team_id, 'rank', rk.rank, 'score', rk.score, 'possible', rk.possible,
                  'alive', rk.alive, 'line', rk.line, 'move', rk.move) order by rk.rank, rk.gm_name)) j
      from rk group by rk.game)
    select jsonb_agg(g.j order by g.game = top desc, g.status = 'open' desc, g.game) from g), '[]'::jsonb));
end $$;
revoke execute on function public.pool_scoreboard() from public, anon;
grant execute on function public.pool_scoreboard() to authenticated;

-- the host names the pool's main game (null hands it back to the default)
create or replace function public.pool_set_crown(p_game text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p_game is not null and not exists (select 1 from _pool_rows() r where r.game = p_game) then
    raise exception 'This pool doesn''t run that game';
  end if;
  update league_rules set crown = p_game where league_id = current_league_id();
  return _pool_crown();
end $$;
revoke execute on function public.pool_set_crown(text) from public, anon;
grant execute on function public.pool_set_crown(text) to authenticated;

-- ───────────── moving the standings on ─────────────
-- 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st
create or replace function public._ordinal(n int) returns text
language sql immutable as $$
  select n || case when n % 100 between 11 and 13 then 'th' when n % 10 = 1 then 'st' when n % 10 = 2 then 'nd' when n % 10 = 3 then 'rd' else 'th' end
$$;

-- the hourly look at a pool: record where everyone stands, start the day's arrows afresh after midnight Eastern, and
-- tell anyone who climbed into first or three places or more since the last look (once a game a day)
create or replace function public._pool_mark() returns int
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); d date := today_et(); r record; s pool_standing; n int := 0;
begin
  if lid is null or (select kind from leagues where id = lid) is distinct from 'predict' then return 0; end if;
  for r in select * from _pool_ranked() loop
    select * into s from pool_standing ps where ps.league_id = lid and ps.game = r.game and ps.team_id = r.team_id;
    if s.game is null then
      insert into pool_standing (league_id, game, team_id, rank, score, day_rank, day) values (lid, r.game, r.team_id, r.rank, r.score, r.rank, d);
      continue;
    end if;
    if s.day <> d then s.day_rank := s.rank; s.day := d; end if;
    if r.status = 'open' and r.members >= 3 and r.score > 0 and r.rank < s.rank and (r.rank = 1 or s.rank - r.rank >= 3)
       and s.alerted is distinct from d then
      perform _pool_alert(r.team_id, 'pool_rank',
        case when r.rank = 1 then format('👑 You''re top of %s.', r.title)
             else format('📈 Up %s places to %s in %s.', s.rank - r.rank, _ordinal(r.rank), r.title) end, r.link);
      s.alerted := d;
      n := n + 1;
    end if;
    update pool_standing ps set rank = r.rank, score = r.score, day_rank = s.day_rank, day = s.day, alerted = s.alerted, updated_at = now()
    where ps.league_id = lid and ps.game = r.game and ps.team_id = r.team_id;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_mark() from public, anon, authenticated;

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
