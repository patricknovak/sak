-- Fixes from a sixth independent review (migrations 234 to 236):
-- * The sweepstake's field is every club in the event from its round on, byes included (MLB's top seeds join in the
--   Division Series), and it is offered only once the whole bracket is filed: a knockout of S series has S + 1 clubs,
--   so the field must count exactly that and the last round must be one series (the NFL's later rounds, filed only
--   once ESPN names both sides, wait). The field, the number of series and of rounds are kept with the deal.
-- * It is crowned only when every one of those series is decided and exactly one club never lost, never from whichever
--   round happens to be last on file; a club is out once it has lost a series, so a club waiting for the next round's
--   row reads as still in.
-- * The clubs are dealt round the pool in turn, so everyone holds one and some hold one more; none is left in the hat
--   unless the pool is empty. The tick also draws once the round is under way when its start times were never known.
-- * A player who joined after the draw reads so on the scoreboard. The host can't change rules on a sweepstake or a
--   streak (nothing to change, and a save can no longer race the draw).
-- * The daily streak: one pick a day however the feed moved games (the one filed under its day wins, then the latest);
--   a day's pick filed under it can't be replaced once its game has started, wherever that game now is; a pick on a game
--   its series didn't need frees the day; and the streak closes only after a quiet week with nothing left to play (and,
--   on a postseason, once its one-series last round is decided), never in a gap between rounds.
-- Safe to run twice.

-- the event from a round on, as a knockout: its series, its clubs and its rounds, and whether it is all filed
create or replace function public._sweep_shape(p_competition text, p_round int)
returns table (series_n int, clubs bigint[], rounds int, complete boolean)
language sql stable security definer set search_path = public as $$
  with s as (select * from series where competition = p_competition and round >= p_round),
  c as (select distinct x c from s, unnest(array[s.high_club, s.low_club]) x where x is not null)
  select (select count(*) from s)::int, (select array_agg(c order by c) from c), (select count(distinct round) from s)::int,
    (select count(*) from c) = (select count(*) from s) + 1
      and (select count(*) from s where round = (select max(round) from s)) = 1
      and (select count(distinct round) from s) = (select max(round) - p_round + 1 from s)
$$;
revoke execute on function public._sweep_shape(text, int) from public, anon, authenticated;

create or replace function public._sweep_ok(p_competition text, p_round int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_round is not null
    and exists (select 1 from series where competition = p_competition and round = p_round)
    and not exists (select 1 from series where competition = p_competition and round = p_round
                    and (high_club is null or low_club is null or state <> 'scheduled' or (starts_at is not null and starts_at <= now())))
    and coalesce((select complete from _sweep_shape(p_competition, p_round)), false)
$$;
revoke execute on function public._sweep_ok(text, int) from public, anon, authenticated;

-- deal the field round the pool: the players in a random order, the clubs shuffled, one each in turn
create or replace function public._sweep_draw(p_game bigint) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; ms int[]; cs bigint[]; n int; m int; deal jsonb := '{}'; i int; mine bigint[]; t int; sh record;
begin
  select * into g from pool_games where id = p_game for update;
  if g.id is null or g.kind <> 'sweep' or g.status <> 'open' or g.rules ? 'deal' then return 0; end if;
  select * into sh from _sweep_shape(g.competition, (g.rules->>'from_round')::int);
  select array_agg(id order by random()) into ms from teams where league_id = g.league_id and role = 'gm';
  select array_agg(c order by random()) into cs from unnest(sh.clubs) c;
  n := coalesce(cardinality(ms), 0); m := coalesce(cardinality(cs), 0);
  if n = 0 or m = 0 then return 0; end if;
  for i in 1..greatest(n, m) loop
    t := ms[((i - 1) % n) + 1];
    deal := jsonb_set(deal, array[t::text], coalesce(deal->(t::text), '[]') || to_jsonb(cs[((i - 1) % m) + 1]));
  end loop;
  update pool_games set rules = rules || jsonb_build_object('deal', deal, 'unheld', '[]'::jsonb, 'drawn_at', now(),
    'field', to_jsonb(sh.clubs), 'series_n', sh.series_n, 'rounds', sh.rounds) where id = g.id;
  foreach t in array ms loop
    select array_agg(distinct x::bigint) into mine from jsonb_array_elements_text(deal->t::text) x;
    perform _pool_alert(t, 'pool_game', format('🎩 You drew %s in the sweepstake.',
      (select string_agg(coalesce(c.name, c.short), ' and ' order by c.name) from clubs c where c.id = any (mine))), '/picks?g=' || g.id);
  end loop;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('🎩 The sweepstake is drawn: %s clubs dealt to %s players. Hold the champion and you win it.', m, n),
    jsonb_build_object('pool_game', g.id), g.league_id);
  return 1;
end $$;
revoke execute on function public._sweep_draw(bigint) from public, anon, authenticated;

-- each club in the field: series won, still in (it hasn't lost one), and who holds it
create or replace function public._sweep_clubs(p_game bigint)
returns table (club bigint, won int, alive boolean, holders int[])
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  field as (select x::bigint club from g, jsonb_array_elements_text(g.rules->'field') x
            union
            select unnest(sh.clubs) from g cross join lateral _sweep_shape(g.competition, (g.rules->>'from_round')::int) sh where not g.rules ? 'field')
  select f.club,
    (select count(*) from series s, g where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int and s.winner = f.club)::int,
    not exists (select 1 from series s, g where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
                and s.state = 'final' and s.winner is not null and f.club in (s.high_club, s.low_club) and s.winner <> f.club),
    coalesce((select array_agg(d.key::int order by d.key::int) from g, jsonb_each(coalesce(g.rules->'deal', '{}')) d where d.value @> to_jsonb(f.club)), '{}')
  from field f where f.club is not null
$$;
revoke execute on function public._sweep_clubs(bigint) from public, anon, authenticated;

-- the champion, once every series of the event from the round is decided and exactly one club never lost
create or replace function public._sweep_champion(p_game bigint) returns bigint
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and rules ? 'deal'),
  done as (select count(*) n from series s, g where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
           and s.state = 'final' and s.winner is not null),
  open as (select count(*) n from series s, g where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
           and not (s.state = 'final' and s.winner is not null))
  select case when (select n from done) >= (select (rules->>'series_n')::int from g) and (select n from open) = 0
              and (select count(*) from _sweep_clubs(p_game) c where c.alive) = 1
         then (select c.club from _sweep_clubs(p_game) c where c.alive) end
$$;
revoke execute on function public._sweep_champion(bigint) from public, anon, authenticated;

create or replace function public._sweep_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  rounds as (select coalesce((g.rules->>'rounds')::int, (select sh.rounds from _sweep_shape(g.competition, (g.rules->>'from_round')::int) sh)) n from g),
  c as (select * from _sweep_clubs(p_game)),
  held as (select tm.id team_id, c.* from teams tm, g, c where tm.league_id = g.league_id and tm.role = 'gm' and tm.id = any (c.holders))
  select tm.id::int,
    coalesce((select max(h.won) from held h where h.team_id = tm.id), 0)::int,
    coalesce((select max(case when h.alive then (select n from rounds) else h.won end) from held h where h.team_id = tm.id), 0)::int,
    (select count(*) from held h where h.team_id = tm.id and h.alive)::int,
    0,
    (select count(*) from held h where h.team_id = tm.id)::int,
    (-coalesce((select sum(h.won) from held h where h.team_id = tm.id), 0))::int
  from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'
$$;
revoke execute on function public._sweep_table(bigint) from public, anon, authenticated;

create or replace function public._sweep_board(p_game bigint, p_me int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('drawn', g.rules ? 'deal', 'drawn_at', g.rules->'drawn_at', 'locks_at', _rank_lock(g.id),
    'round_label', (select regexp_replace(min(label), '^(AL|NL|AFC|NFC|East|West) ', '') from series where competition = g.competition and round = (g.rules->>'from_round')::int),
    'players', (select count(*) from teams where league_id = g.league_id and role = 'gm'),
    'mine', coalesce(g.rules->'deal'->(p_me::text), '[]'), 'unheld', coalesce(g.rules->'unheld', '[]'),
    'champion', _sweep_champion(g.id),
    'field', coalesce((select jsonb_agg(_club_json(c.club) || jsonb_build_object('won', c.won, 'alive', c.alive, 'holders', to_jsonb(c.holders))
                        order by c.alive desc, c.won desc, c.club) from _sweep_clubs(g.id) c), '[]'))
  from pool_games g where g.id = p_game and g.kind = 'sweep'
$$;
revoke execute on function public._sweep_board(bigint, int) from public, anon, authenticated;

create or replace function public._sweep_tick(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; n int := 0; champ bigint; w int[]; names text;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games where league_id = p_league and kind = 'sweep' and status = 'open' loop
    if not g.rules ? 'deal' then
      -- at the first game, or once the round is under way where its start times were never known
      if _rank_lock(g.id) <= now() or exists (select 1 from series s where s.competition = g.competition
                                               and s.round = (g.rules->>'from_round')::int and s.state <> 'scheduled') then
        n := n + _sweep_draw(g.id);
      end if;
      continue;
    end if;
    champ := _sweep_champion(g.id);
    continue when champ is null;
    select coalesce(array_agg(d.key::int order by d.key::int), '{}') into w from jsonb_each(g.rules->'deal') d where d.value @> to_jsonb(champ);
    update pool_games set status = 'done', winners = w where id = g.id and status = 'open';
    select string_agg(tm.gm_name, ' and ' order by tm.gm_name) into names from teams tm where tm.id = any (w);
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      case when names is null then format('🎩 The sweepstake is over: %s won it, and nobody held them.', (select coalesce(name, short) from clubs where id = champ))
           else format('🏆 The sweepstake is won: %s held %s.', names, (select coalesce(name, short) from clubs where id = champ)) end,
      jsonb_build_object('pool_game', g.id), g.league_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._sweep_tick(int) from public, anon, authenticated;

-- every pick with its game's result, one a day: where the feed moved a game onto a day that has a pick already, the
-- one filed under that day counts, then the latest
create or replace function public._streak_picks(p_game bigint)
returns table (team_id int, day date, fixture bigint, pick text, kickoff timestamptz, res text, void boolean, is_right boolean)
language sql stable security definer set search_path = public as $$
  select x.team_id, x.day, x.fixture, x.pick, x.kickoff, x.res, x.void, case when x.void then null when x.res is not null then x.pick = x.res end
  from (select distinct on (pk.team_id, _streak_day(f.kickoff))
          pk.team_id, _streak_day(f.kickoff) as day, f.id fixture, pk.pick->>'pick' pick, f.kickoff, e.res,
          e.void or (f.state = 'scheduled' and not _streak_playable(f.id))
            or (e.res = 'D' and not coalesce((g.rules->>'draws')::boolean, false)) void
        from pool_picks pk join pool_games g on g.id = pk.game_id
        join fixtures f on f.id = (pk.pick->>'fixture')::bigint
        cross join lateral _pool_fixture(g.league_id, f.id) e
        where pk.game_id = p_game and pk.thing like 'd:%'
        order by pk.team_id, _streak_day(f.kickoff), (pk.thing = 'd:' || to_char(_streak_day(f.kickoff), 'YYYY-MM-DD')) desc, pk.picked_at desc) x
$$;
revoke execute on function public._streak_picks(bigint) from public, anon, authenticated;

create or replace function public._pool_game_pick_as(p_team int, p_game bigint, p_thing text, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := p_team; s series; w bigint; n int; lock_at timestamptz; ord jsonb; v text; last_r int; t record; fr int; lens jsonb;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if (select role from teams where id = me) <> 'gm' then raise exception 'Only players pick'; end if;
  if p_thing like 's:%' and g.kind = 'series' then
    select * into s from series where id = substr(p_thing, 3)::bigint and competition = g.competition;
    if s.id is null or s.round < (g.rules->>'from_round')::int then raise exception 'That series isn''t in this game'; end if;
    if s.high_club is null or s.low_club is null then raise exception 'That series isn''t set yet'; end if;
    if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'That series has started; picks are locked'; end if;
    w := (p_pick->>'winner')::bigint; n := (p_pick->>'games')::int;
    if w not in (s.high_club, s.low_club) then raise exception 'Pick one of the two clubs'; end if;
    if n is null or n not between (s.best_of / 2 + 1) and s.best_of then raise exception 'A best-of-% goes % to % games', s.best_of, s.best_of / 2 + 1, s.best_of; end if;
    p_pick := jsonb_build_object('winner', w, 'games', n);
  elsif p_thing = 'rank' and g.kind = 'rank' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The ranking locked at the first %', _sport_word(g.competition, 'start', 'start'); end if;
    ord := '[]';
    for v in select jsonb_array_elements_text(coalesce(p_pick->'order', '[]')) loop
      if not exists (select 1 from series where competition = g.competition and v::bigint in (high_club, low_club)) then raise exception 'That club isn''t in this event'; end if;
      if ord @> to_jsonb(v::bigint) then raise exception 'Each club once'; end if;
      ord := ord || to_jsonb(v::bigint);
    end loop;
    if jsonb_array_length(ord) < 2 then raise exception 'Put the clubs in order'; end if;
    p_pick := jsonb_build_object('order', ord);
  elsif p_thing = 'bracket' and g.kind = 'bracket' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The bracket locked at the first game'; end if;
    fr := (g.rules->>'from_round')::int;
    -- round by round: a first-round winner is one of its two clubs, a later one a winner picked in a series before it
    ord := '{}';
    for t in select tr.series_id, tr.round, x.high_club, x.low_club from _bracket_tree(g.competition, fr) tr join series x on x.id = tr.series_id
             order by tr.round, tr.pos loop
      w := (p_pick->'winners'->>t.series_id::text)::bigint;
      if w is null then raise exception 'Pick a winner for every series'; end if;
      if t.round = fr then
        if w not in (t.high_club, t.low_club) then raise exception 'Pick one of the two clubs'; end if;
      elsif not exists (select 1 from _bracket_tree(g.competition, fr) b where b.next_id = t.series_id and (ord->>b.series_id::text)::bigint = w) then
        raise exception 'A winner goes on only from a series before it';
      end if;
      ord := ord || jsonb_build_object(t.series_id::text, w);
    end loop;
    -- and, where the host added a bonus for it, how many games each series goes (migration 228)
    lens := '{}';
    if coalesce((g.rules->>'games_bonus')::int, 0) > 0 then
      for t in select x.id, x.best_of from _bracket_tree(g.competition, fr) tr join series x on x.id = tr.series_id where x.best_of > 1 loop
        v := p_pick->'lengths'->>t.id::text;
        continue when v is null;
        if v !~ '^\d+$' or v::int not between t.best_of / 2 + 1 and t.best_of then
          raise exception 'A best-of-% goes % to % games', t.best_of, t.best_of / 2 + 1, t.best_of;
        end if;
        lens := lens || jsonb_build_object(t.id::text, v::int);
      end loop;
    end if;
    p_pick := jsonb_build_object('winners', ord) || case when lens <> '{}' then jsonb_build_object('lengths', lens) else '{}' end;
  elsif p_thing = 'box' and g.kind = 'players' then
    lock_at := _players_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'Teams locked at the first puck drop'; end if;
    -- one player from every box, in box order
    ord := '[]';
    for t in select b.v, (b.ord - 1)::int i from jsonb_array_elements(g.rules->'boxes') with ordinality b(v, ord) order by b.ord loop
      v := p_pick->'players'->>t.i;
      if v is null then raise exception 'Take a player from every box'; end if;
      if not (t.v->'players' @> to_jsonb(v::int)) then raise exception 'That player isn''t in %', t.v->>'label'; end if;
      ord := ord || to_jsonb(v::int);
    end loop;
    if jsonb_array_length(coalesce(p_pick->'players', '[]')) <> jsonb_array_length(ord) then raise exception 'One player from each box'; end if;
    p_pick := jsonb_build_object('players', ord);
  elsif p_thing = 'props' and g.kind = 'props' then
    if exists (select 1 from fixtures f where f.id = (g.rules->>'fixture')::bigint and (f.state <> 'scheduled' or f.kickoff <= now())) then
      raise exception 'The sheet locked at the %', _sport_word(g.competition, 'start', 'start');
    end if;
    -- every call answered with one of its options, and the game's total for the tiebreak
    ord := '{}';
    for t in select q from jsonb_array_elements(g.rules->'questions') q loop
      v := p_pick->'answers'->>(t.q->>'key');
      if v is null then raise exception 'Make every call'; end if;
      if not exists (select 1 from jsonb_array_elements(t.q->'options') o where o->>'v' = v) then raise exception 'That isn''t one of the answers'; end if;
      ord := ord || jsonb_build_object(t.q->>'key', v);
    end loop;
    n := (p_pick->>'total')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('answers', ord, 'total', n);
  elsif p_thing = 'streak' and g.kind = 'streak' then
    -- one pick a day, on any game that day still to start; a day's pick moves until its game starts
    select f.id, f.kickoff, f.state, f.home_club, f.away_club into t from fixtures f
    where f.id = (p_pick->>'fixture')::bigint and f.competition = g.competition;
    if t.id is null or t.home_club is null or t.away_club is null then raise exception 'That game isn''t in this event'; end if;
    if t.state <> 'scheduled' or t.kickoff <= now() or not (select e.open from _pool_fixture(g.league_id, t.id) e) then
      raise exception 'That game has started; pick one still to come';
    end if;
    if not _streak_playable(t.id) then raise exception 'That game won''t be played: its series is over'; end if;
    p_thing := 'd:' || to_char(_streak_day(t.kickoff), 'YYYY-MM-DD');
    -- the day is the one the picked game is on now; it locks once that game is under way or over (one put off or
    -- voided frees it)
    if exists (select 1 from pool_picks pk join fixtures f on f.id = (pk.pick->>'fixture')::bigint
               cross join lateral _pool_fixture(g.league_id, f.id) e
               where pk.game_id = g.id and pk.team_id = me and pk.thing like 'd:%'
                 -- a pick on this day, or the one filed under it whose game has moved
                 and (_streak_day(f.kickoff) = _streak_day(t.kickoff) or pk.thing = p_thing)
                 -- one under way or over holds the day; one put off, voided or not needed by its series frees it
                 and not (e.open or e.void or (f.state = 'scheduled' and not _streak_playable(f.id)))) then
      raise exception 'Your pick for that day has started; it stays';
    end if;
    -- a pick filed under this day whose game has moved to another goes with its game (unless that day has one)
    update pool_picks pk set thing = 'd:' || to_char(_streak_day(f.kickoff), 'YYYY-MM-DD') from fixtures f
    where pk.game_id = g.id and pk.team_id = me and pk.thing = p_thing and f.id = (pk.pick->>'fixture')::bigint
      and _streak_day(f.kickoff) <> _streak_day(t.kickoff)
      and not exists (select 1 from pool_picks q where q.game_id = g.id and q.team_id = me and q.thing = 'd:' || to_char(_streak_day(f.kickoff), 'YYYY-MM-DD'));
    -- and a pick filed under another day whose game has moved onto this one gives way to this one
    delete from pool_picks pk using fixtures f
    where pk.game_id = g.id and pk.team_id = me and pk.thing like 'd:%' and pk.thing <> p_thing
      and f.id = (pk.pick->>'fixture')::bigint and _streak_day(f.kickoff) = _streak_day(t.kickoff);
    v := p_pick->>'pick';
    if v is null or v not in ('H', 'A', 'D') or (v = 'D' and not coalesce((g.rules->>'draws')::boolean, false)) then
      raise exception 'Pick one of the two sides%', case when coalesce((g.rules->>'draws')::boolean, false) then ', or a draw' else '' end;
    end if;
    p_pick := jsonb_build_object('fixture', t.id, 'pick', v);
  elsif p_thing = 'tiebreak' and g.kind = 'bracket' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked with the bracket'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n);
  elsif p_thing = 'tiebreak' and g.kind = 'series' then
    select max(round) into last_r from series where competition = g.competition;
    lock_at := (select min(starts_at) from series where competition = g.competition and round = last_r);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked at the first % of the final round', _sport_word(g.competition, 'start', 'start'); end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n);
  else
    raise exception 'Nothing to pick there';
  end if;
  insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, p_thing, p_pick)
  on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
  return p_pick;
end $$;
revoke execute on function public._pool_game_pick_as(int, bigint, text, jsonb) from public, anon, authenticated;

create or replace function public._streak_close(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; best record; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games pg where pg.league_id = p_league and pg.kind = 'streak' and pg.status = 'open'
             and not exists (select 1 from fixtures f where f.competition = pg.competition and f.state in ('scheduled', 'live') and _streak_playable(f.id))
             and not exists (select 1 from series s where s.competition = pg.competition and s.state <> 'final')
             -- a quiet week: nothing has been played for seven days (a gap between rounds or matchweeks is shorter)
             and not exists (select 1 from fixtures f where f.competition = pg.competition and f.state = 'final' and f.kickoff > now() - interval '7 days')
             -- and a postseason ends with a last round of one series, decided
             and (not exists (select 1 from series s where s.competition = pg.competition)
                  or (select count(*) from series s where s.competition = pg.competition
                      and s.round = (select max(round) from series where competition = pg.competition)) = 1)
             and exists (select 1 from fixtures f where f.competition = pg.competition and f.state = 'final') loop
    select array_agg(t.team_id order by t.team_id) ids, string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t.points) run into best
    from _streak_table(g.id) t join teams tm on tm.id = t.team_id
    where t.points > 0 and (t.points, -t.tiebreak) = (select x.points, -x.tiebreak from _streak_table(g.id) x order by x.points desc, x.tiebreak limit 1);
    update pool_games set status = 'done', winners = coalesce(best.ids, '{}') where id = g.id and status = 'open';
    if best.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🔥 The daily streak is over: %s won it with a run of %s.', best.names, best.run), jsonb_build_object('pool_game', g.id), g.league_id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._streak_close(int) from public, anon, authenticated;

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
      case when g.kind in ('squares', 'streak') then null else t.possible::numeric end, null::boolean, t.tiebreak::numeric,
      case g.kind
        when 'series' then case when t.right_calls > 0 then format('%s right, %s with the length', t.right_calls, t.exact)
                                when t.picked > 0 then format('%s series picked', t.picked) else 'Nothing picked yet' end
        when 'pickem' then case when t.picked > 0 then format('%s right from %s picked', t.right_calls, t.picked) else 'Nothing picked yet' end
        when 'bracket' then case when t.right_calls > 0 then format('%s right', t.right_calls) when t.picked > 0 then 'Bracket in' else 'No bracket yet' end
        when 'players' then case when t.right_calls + t.exact > 0 then format('%s goal%s, %s assist%s', t.right_calls, case when t.right_calls = 1 then '' else 's' end,
                                                                   t.exact, case when t.exact = 1 then '' else 's' end)
                                 when t.picked > 0 then 'Team in' else 'No team yet' end
        when 'props' then case when t.picked > 0 then format('%s right', t.right_calls) else 'No sheet yet' end
        when 'streak' then case when t.picked > 0 then format('Best run %s, %s now', t.points, t.exact) else 'Nothing picked yet' end
        when 'sweep' then case when t.picked = 0 and g.rules ? 'deal' then 'Joined after the draw' when t.picked = 0 then 'In the hat' when t.right_calls > 0 then format('%s of %s club%s still in', t.right_calls, t.picked, case when t.picked = 1 then '' else 's' end)
                          else 'All out' end
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

create or replace function public.pool_game_set_rules(p_game bigint, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; r jsonb; base jsonb;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if _pool_game_locked(g.id) then raise exception 'The rules froze at the first lock'; end if;
  if g.kind = 'props' then raise exception 'The sheet has no rules to change: every call is a point, settled from the score'; end if;
  if g.kind in ('sweep', 'streak') then raise exception '% has no rules to change', g.title; end if;
  if g.kind = 'pickem' and coalesce(p_rules->>'preset', g.rules->>'preset') <> g.rules->>'preset'
     and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Picks are in, so the scoring stays: it changes only before anyone picks';
  end if;
  -- what was worked out from a preset is worked out again from the new one
  base := case when g.kind = 'players' then g.rules else g.rules - 'points' - 'length' - 'exact_only' - 'weights' - 'draws' - 'per' end;
  r := _pool_game_rules(g.kind, g.competition, base || coalesce(p_rules, '{}')
         || jsonb_strip_nulls(jsonb_build_object('from_round', g.rules->'from_round', 'series', g.rules->'series', 'fixture', g.rules->'fixture')));
  -- a box pool's boxes stay once a team is in
  if g.kind = 'players' and r->>'key' is distinct from g.rules->>'key' and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Teams are in, so the boxes stay: the size, the nights and the scoring change only before anyone picks';
  end if;
  update pool_games set rules = r where id = g.id;
  perform _sys('general', format('📝 The host changed the rules of %s before the first lock.', g.title), jsonb_build_object('pool_game', g.id));
  return r;
end $$;
revoke execute on function public.pool_game_set_rules(bigint, jsonb) from public, anon;
grant execute on function public.pool_game_set_rules(bigint, jsonb) to authenticated;

