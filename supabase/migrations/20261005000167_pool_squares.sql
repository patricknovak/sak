-- Squares (docs/POOL-TYPES.md §2.6, SUPERPOOLS P9): the grid on one series, in coins, the pool game people who don't
-- follow baseball love most.
--
-- * The grid: 10 by 10 (the classic) or 5 by 5 for a small group, where each row and column carries two digits. Members
--   claim squares at the price the host set, paid from their coins, up to the cap if there is one, or let the grid pick
--   for them. A square can be handed back for a refund until the digits are drawn.
-- * The draw: the digits 0 to 9 for each club, shuffled from a recorded seed (each digit ordered by the md5 of the seed,
--   the game and the side), the moment the grid is full or at Game 1's first pitch, whichever comes first. Anyone can
--   check the order from the seed with `_squares_digits`. One draw for the series, or fresh digits every game.
-- * The pot: everything paid in, split evenly over the games the series can run to, and each game's share paid at its
--   checkpoints: after the 3rd, the 6th and the final (25/25/50), or the final score alone. The last digit of each
--   club's runs names the square; an empty square passes the coins to the next claimed square along the rows. The last
--   game's final takes whatever is left, so the games a short series never plays still pay out.
-- * Paid as the feed lands: `sport_ingest` ends by settling every grid on its event, and the hourly pool job draws any
--   grid whose first pitch has passed. A payout is written once (`pool_square_pays`) and moves coins once.

set client_min_messages = warning;

alter table public.pool_games drop constraint if exists pool_games_kind_check;
alter table public.pool_games add constraint pool_games_kind_check check (kind in ('series', 'rank', 'squares'));
-- the draw: the seed, when and why, the digits (one set, or one per game), the pot and the squares in it
alter table public.pool_games add column if not exists draw jsonb;

-- a square has one owner
create unique index if not exists pool_picks_one_square on public.pool_picks (game_id, thing) where thing like 'sq:%';

-- every payout: the game and the checkpoint, the runs, the square the digits named and where the coins went
create table if not exists public.pool_square_pays (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.pool_games (id) on delete cascade,
  league_id int not null default current_league_id() references public.leagues (id),
  fixture_id bigint not null references public.fixtures (id),
  game_no int not null,
  point int not null,                             -- after this inning; 0 the final score
  top_runs int not null,
  side_runs int not null,
  cell text not null,                             -- 'sq:<row>:<column>', the square the digits name
  paid_cell text,                                 -- the square that took it (the next claimed one when that is empty)
  team_id int references public.teams (id),
  coins int not null,
  created_at timestamptz not null default now(),
  unique (game_id, fixture_id, point)
);
create index if not exists pool_square_pays_game on public.pool_square_pays (game_id);
alter table public.pool_square_pays enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.pool_square_pays'::regclass and polname = 'league_read') then
    create policy league_read on public.pool_square_pays for select to authenticated using (league_id = (select current_league_id()));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pool_square_pays'::regclass and tgname = 'pool_square_pays_stamp_league') then
    create trigger pool_square_pays_stamp_league before insert on public.pool_square_pays for each row execute function public._stamp_league();
  end if;
end $$;
revoke all on public.pool_square_pays from anon, authenticated;
grant select on public.pool_square_pays to authenticated;
grant all on public.pool_square_pays to service_role;

-- ───────────── the digits and the squares ─────────────
-- the digits 0 to 9 in the order the seed gives them, for one side of one set
create or replace function public._squares_digits(p_seed text, p_set int, p_side text) returns int[]
language sql immutable set search_path = public as $$
  select array_agg(d order by md5(p_seed || ':' || p_set || ':' || p_side || ':' || d), d) from generate_series(0, 9) d
$$;
grant execute on function public._squares_digits(text, int, text) to anon, authenticated;

-- the square the runs name: the row from the side club's last digit, the column from the top club's; on a 5 by 5 grid
-- each row and column carries two digits
create or replace function public._squares_cell(p_draw jsonb, p_size int, p_game_no int, p_top int, p_side int) returns text
language sql immutable set search_path = public as $$
  with s as (select coalesce(p_draw->'sets'->(least(greatest(p_game_no, 1), jsonb_array_length(p_draw->'sets')) - 1), p_draw->'sets'->0) x)
  select format('sq:%s:%s',
    (select (a.i - 1) / (10 / p_size) from s, jsonb_array_elements_text(s.x->'side') with ordinality a(v, i) where a.v::int = p_side % 10),
    (select (a.i - 1) / (10 / p_size) from s, jsonb_array_elements_text(s.x->'top') with ordinality a(v, i) where a.v::int = p_top % 10))
$$;

-- who takes a square's coins: its owner, or the next claimed square along the rows (round to the top)
create or replace function public._squares_owner(p_game bigint, p_size int, p_cell text) returns table (cell text, team_id int)
language sql stable security definer set search_path = public as $$
  with c as (select split_part(p_cell, ':', 2)::int * p_size + split_part(p_cell, ':', 3)::int pos)
  select pk.thing, pk.team_id from pool_picks pk, c
  where pk.game_id = p_game and pk.thing like 'sq:%'
  order by (split_part(pk.thing, ':', 2)::int * p_size + split_part(pk.thing, ':', 3)::int - c.pos + p_size * p_size) % (p_size * p_size)
  limit 1
$$;
revoke execute on function public._squares_owner(bigint, int, text) from public, anon, authenticated;

-- "after the 3rd", "the final"
create or replace function public._squares_point(p int) returns text
language sql immutable set search_path = public as $$
  select case when p = 0 then 'the final' else 'after the ' || p || case when p % 100 between 11 and 13 then 'th' when p % 10 = 1 then 'st'
    when p % 10 = 2 then 'nd' when p % 10 = 3 then 'rd' else 'th' end end
$$;

-- ───────────── rules ─────────────
-- the knobs per kind; squares run on one series still to start (by default the event's last round, when it has one)
create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint;
begin
  if p_kind = 'squares' then
    sid := (r->>'series')::bigint;
    if sid is null then
      if (select count(*) from series where competition = p_competition and round = (select max(round) from series where competition = p_competition)) <> 1 then
        raise exception 'Pick the series the grid is on';
      end if;
      sid := (select id from series where competition = p_competition order by round desc limit 1);
    end if;
    select * into s from series where id = sid and competition = p_competition;
    if s.id is null then raise exception 'Pick the series the grid is on'; end if;
    if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'That series has started; pick one still to come'; end if;
    sz := coalesce((r->>'size')::int, 10);
    if sz not in (5, 10) then raise exception 'A grid is 10 by 10 or 5 by 5'; end if;
    cost := coalesce((r->>'cost')::int, 10);
    if cost not between 1 and 500 then raise exception 'A square costs 1 to 500 coins'; end if;
    cap := coalesce((r->>'cap')::int, 0);
    if cap not between 0 and sz * sz then raise exception 'The cap is up to % squares each (0 for none)', sz * sz; end if;
    pays := coalesce(r->>'pays', 'innings');
    if pays not in ('innings', 'final') then raise exception 'Pay after the 3rd, the 6th and the final, or the final score only'; end if;
    digits := coalesce(r->>'digits', 'once');
    if digits not in ('once', 'each') then raise exception 'Draw the digits once, or fresh for each game'; end if;
    return jsonb_build_object('series', sid, 'size', sz, 'cost', cost, 'cap', cap, 'pays', pays, 'digits', digits,
      'points', case pays when 'innings' then '[3, 6, 0]'::jsonb else '[0]'::jsonb end,
      'weights', case pays when 'innings' then '[25, 25, 50]'::jsonb else '[100]'::jsonb end);
  end if;
  select * into ev from _event_rounds(p_competition);
  if ev.last_round is null then raise exception 'That event has no rounds yet'; end if;
  fr := coalesce((r->>'from_round')::int, ev.open_round);
  if fr is null then raise exception 'Every round of that event has started'; end if;
  if fr < ev.first_round or fr > ev.last_round then raise exception 'No such round'; end if;
  if ev.open_round is null or fr < ev.open_round then raise exception 'That round has already started; start from the next one'; end if;
  if p_kind = 'series' then
    preset := coalesce(r->>'preset', 'classic');
    if preset not in ('classic', 'flat', 'exact') then raise exception 'Pick a scoring: Classic, Flat or MLB.com'; end if;
    pts := case preset when 'classic' then '{"1":1,"2":2,"3":4,"4":8}' when 'flat' then '{"1":1,"2":1,"3":1,"4":1}' else '{"1":1,"2":1,"3":1,"4":1}' end;
    len := case preset when 'classic' then '{"1":1,"2":1,"3":2,"4":3}' when 'flat' then '{"1":1,"2":1,"3":1,"4":1}' else '{"1":0,"2":0,"3":0,"4":0}' end;
    pts := pts || coalesce(r->'points', '{}'); len := len || coalesce(r->'length', '{}');
    for k in select jsonb_object_keys(pts) union select jsonb_object_keys(len) loop
      if coalesce((pts->>k)::int, 0) not between 0 and 100 or coalesce((len->>k)::int, 0) not between 0 and 100 then
        raise exception 'Points are whole numbers from 0 to 100';
      end if;
    end loop;
    return jsonb_build_object('preset', preset, 'from_round', fr, 'points', pts, 'length', len, 'exact_only', preset = 'exact',
      'tiebreak', coalesce((r->>'tiebreak')::boolean, true));
  elsif p_kind = 'rank' then
    return jsonb_build_object('from_round', fr, 'per', 'game');
  end if;
  raise exception 'No such kind of game';
end $$;
revoke execute on function public._pool_game_rules(text, text, jsonb) from public, anon, authenticated;

-- ───────────── starting a game ─────────────
create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions; s series;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  -- one game of each kind on an event; squares, one grid on each series
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open'
             and (p_kind <> 'squares' or rules->>'series' = r->>'series')) then
    raise exception 'This pool already runs that game';
  end if;
  if p_kind = 'squares' then
    select * into s from series where id = (r->>'series')::bigint;
    ttl := s.label || ' squares';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🔲 %s are open: %s coins a square, %s. The digits are drawn when the grid fills or at the first pitch of Game 1, and the pot pays %s.',
      ttl, r->>'cost', case when (r->>'size')::int = 10 then '100 squares' else '25 squares with two digits a side' end,
      case when r->>'pays' = 'innings' then 'after the 3rd, the 6th and the final of every game' else 'the final score of every game' end),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  fr_label := (select regexp_replace(min(label), '^(AL|NL|AFC|NFC) ', '') from series where competition = p_competition and round = (r->>'from_round')::int);
  ttl := case p_kind when 'series' then 'Pick the series' else 'Rank the teams' end;
  insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
  perform _sys('general', case p_kind
    when 'series' then format('⚾ Pick the series is on, from the %s: call each series and how many games it goes. Each pick locks at its Game 1''s first pitch.', fr_label)
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first pitch of the round.', fr_label) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
revoke execute on function public._pool_game_create(text, text, jsonb) from public, anon, authenticated;

-- ───────────── claiming ─────────────
-- claim the squares named, plus any number the grid picks at random; paid from the member's coins
create or replace function public.pool_squares_claim(p_game bigint, p_cells text[], p_random int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := _team(); s series; sz int; cost int; cap int; held int; want text[] := '{}'; c text; n int; free int; total int;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id() for update;
  if g.id is null or g.kind <> 'squares' then raise exception 'No such grid here'; end if;
  if (select role from teams where id = me) is distinct from 'gm' then raise exception 'Only players claim squares'; end if;
  if g.status <> 'open' or g.draw is not null then raise exception 'The digits are drawn; the grid is closed'; end if;
  select * into s from series where id = (g.rules->>'series')::bigint;
  if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'The grid closed at the first pitch'; end if;
  sz := (g.rules->>'size')::int; cost := (g.rules->>'cost')::int; cap := coalesce((g.rules->>'cap')::int, 0);
  foreach c in array coalesce(p_cells, '{}') loop
    if c !~ '^sq:\d{1,2}:\d{1,2}$' or split_part(c, ':', 2)::int >= sz or split_part(c, ':', 3)::int >= sz then raise exception 'No such square'; end if;
    if c = any (want) then continue; end if;
    if exists (select 1 from pool_picks where game_id = g.id and thing = c) then raise exception 'Someone has that square already'; end if;
    want := want || c;
  end loop;
  if coalesce(p_random, 0) > 0 then
    want := want || array(select x from (select format('sq:%s:%s', i / sz, i % sz) x from generate_series(0, sz * sz - 1) i) q
                          where x <> all (want) and not exists (select 1 from pool_picks where game_id = g.id and thing = q.x)
                          order by random() limit p_random);
  end if;
  n := coalesce(cardinality(want), 0);
  if n = 0 then raise exception '%', case when coalesce(p_random, 0) > 0 then 'The grid is full' else 'Pick a square' end; end if;
  held := (select count(*) from pool_picks where game_id = g.id and team_id = me and thing like 'sq:%');
  if cap > 0 and held + n > cap then raise exception 'Up to % squares each (you have %)', cap, held; end if;
  free := _coins_free(me);
  if n * cost > free then raise exception 'You have % coins to spend', greatest(free, 0); end if;
  insert into pool_picks (game_id, team_id, thing, pick) select g.id, me, x, '{}'::jsonb from unnest(want) x;
  insert into coin_ledger (team_id, amount, reason) values (me, -n * cost, format('Squares: %s · %s square%s', g.title, n, case when n = 1 then '' else 's' end));
  total := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
  if total >= sz * sz then perform _squares_draw(g.id, 'full'); end if;
  return jsonb_build_object('claimed', to_jsonb(want), 'coins', n * cost, 'full', total >= sz * sz);
end $$;
revoke execute on function public.pool_squares_claim(bigint, text[], int) from public, anon;
grant execute on function public.pool_squares_claim(bigint, text[], int) to authenticated;

-- hand squares back before the draw, for the coins they cost
create or replace function public.pool_squares_release(p_game bigint, p_cells text[]) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := _team(); s series; n int;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id() for update;
  if g.id is null or g.kind <> 'squares' then raise exception 'No such grid here'; end if;
  if g.status <> 'open' or g.draw is not null then raise exception 'The digits are drawn; the squares are set'; end if;
  select * into s from series where id = (g.rules->>'series')::bigint;
  if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'The grid closed at the first pitch'; end if;
  with gone as (delete from pool_picks where game_id = g.id and team_id = me and thing like 'sq:%' and thing = any (coalesce(p_cells, '{}')) returning 1)
  select count(*) into n from gone;
  if n > 0 then
    insert into coin_ledger (team_id, amount, reason) values (me, n * (g.rules->>'cost')::int,
      format('Squares back: %s · %s square%s', g.title, n, case when n = 1 then '' else 's' end));
  end if;
  return n;
end $$;
revoke execute on function public.pool_squares_release(bigint, text[]) from public, anon;
grant execute on function public.pool_squares_release(bigint, text[]) to authenticated;

-- ───────────── the draw ─────────────
create or replace function public._squares_draw(p_game bigint, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; seed text; sets jsonb := '[]'; i int; n int; pot int; h record;
begin
  select * into g from pool_games where id = p_game for update;
  if g.id is null or g.kind <> 'squares' or g.draw is not null then return; end if;
  select * into s from series where id = (g.rules->>'series')::bigint;
  seed := replace(gen_random_uuid()::text, '-', '');
  for i in 1 .. case when g.rules->>'digits' = 'each' then s.best_of else 1 end loop
    sets := sets || jsonb_build_array(jsonb_build_object('top', to_jsonb(_squares_digits(seed, i, 'top')), 'side', to_jsonb(_squares_digits(seed, i, 'side'))));
  end loop;
  n := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
  pot := n * (g.rules->>'cost')::int;
  update pool_games set draw = jsonb_build_object('seed', seed, 'at', now(), 'why', p_why, 'sets', sets, 'pot', pot, 'squares', n,
      'top', s.high_club, 'side', s.low_club),
    status = case when n = 0 then 'done' else status end
  where id = g.id;
  if n = 0 then return; end if;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('🎲 The digits are drawn for %s%s: %s squares, a pot of %s coins. Find your numbers on the grid.', g.title,
      case when p_why = 'full' then ', the grid is full' else '' end, n, pot),
    jsonb_build_object('pool_game', g.id), g.league_id);
  for h in select team_id, count(*) k from pool_picks where game_id = g.id and thing like 'sq:%' group by team_id loop
    perform _pool_alert(h.team_id, 'pool_game', format('🎲 Your %s square%s in %s have their numbers.', h.k, case when h.k = 1 then '' else 's' end, g.title), '/picks?g=' || g.id);
  end loop;
end $$;
revoke execute on function public._squares_draw(bigint, text) from public, anon, authenticated;

-- ───────────── paying out ─────────────
-- every grid on an event (or in a league): draw it once its first pitch has passed, then pay each checkpoint that's in
create or replace function public._squares_tick(p_competition text, p_league int default null) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; f fixtures; i int; pt int; w int; pot int; sz int; top_c bigint; tr int; sr int;
  cell text; own record; amt int; paid int; n int := 0; last_no int; top_name text; side_name text; best record; dname text;
begin
  for g in select * from pool_games where kind = 'squares' and status = 'open'
             and (p_competition is null or competition = p_competition) and (p_league is null or league_id = p_league) order by id loop
    select * into s from series where id = (g.rules->>'series')::bigint;
    if g.draw is null then
      if s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now()) then continue; end if;
      perform _squares_draw(g.id, 'first pitch');
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
    last_no := case when s.state = 'final' then s.high_wins + s.low_wins end;
    for f in select * from fixtures where series_id = s.id and state in ('live', 'final') and game_no is not null order by game_no loop
      for i in 0 .. jsonb_array_length(g.rules->'points') - 1 loop
        pt := (g.rules->'points'->>i)::int; w := (g.rules->'weights'->>i)::int;
        continue when exists (select 1 from pool_square_pays where game_id = g.id and fixture_id = f.id and point = pt);
        if pt = 0 then
          continue when f.state <> 'final';
          tr := case when f.home_club = top_c then f.home_score else f.away_score end;
          sr := case when f.home_club = top_c then f.away_score else f.home_score end;
        else
          -- an inning is in once the next one has begun, or the game is over
          continue when not (f.state = 'final' or exists (select 1 from fixture_periods where fixture_id = f.id and fixture_periods.n > pt and away is not null));
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
          insert into coin_ledger (team_id, amount, reason) values (own.team_id, amt, format('Squares: %s · Game %s, %s', g.title, f.game_no, _squares_point(pt)));
          perform _pool_alert(own.team_id, 'pool_game', format('🔲 Your square hit: %s %s, %s %s, Game %s %s. +%s coins', top_name, tr, side_name, sr, f.game_no, _squares_point(pt), amt),
            '/picks?g=' || g.id);
          insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
            format('🔲 Game %s, %s: %s %s, %s %s. %s%s square takes %s coins.', f.game_no, _squares_point(pt), top_name, tr, side_name, sr, dname,
              case when own.cell is distinct from cell then '''s next' else '''s' end, amt),
            jsonb_build_object('pool_game', g.id, 'fixture', f.id), g.league_id);
        end if;
        n := n + 1;
      end loop;
    end loop;
    -- the series is over and its last final is paid: the grid is done
    if last_no is not null and exists (select 1 from pool_square_pays p join fixtures x on x.id = p.fixture_id
                                       where p.game_id = g.id and p.point = 0 and x.game_no = last_no) then
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

-- the adapters' one write ends by settling the grids on the event
create or replace function public.sport_ingest(p_competition text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c competitions; x jsonb; y jsonb; nc int := 0; ns int := 0; nf int := 0; hc bigint; ac bigint; sid bigint; fid bigint; s record; need int;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition %', p_competition; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'clubs', '[]')) loop
    insert into clubs (sport, provider, ext_id, name, short, logo, color)
    values (c.sport, c.provider, x->>'ext_id', left(x->>'name', 80), nullif(left(x->>'short', 5), ''), nullif(x->>'logo', ''), nullif(x->>'color', ''))
    on conflict (sport, provider, ext_id) do update set name = excluded.name, short = coalesce(excluded.short, clubs.short),
      logo = coalesce(excluded.logo, clubs.logo), color = coalesce(excluded.color, clubs.color);
    nc := nc + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'series', '[]')) loop
    insert into series (sport, competition, provider, ext_id, round, label, short, best_of, high_club, low_club, starts_at, tbd, sort, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', (x->>'round')::int, left(x->>'label', 80), nullif(left(x->>'short', 12), ''), (x->>'best_of')::int,
      (select id from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'high'),
      (select id from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'low'),
      nullif(x->>'starts_at', '')::timestamptz, coalesce((x->>'tbd')::boolean, false), coalesce((x->>'sort')::int, 0), now())
    on conflict (provider, ext_id) do update set round = excluded.round, label = excluded.label, short = coalesce(excluded.short, series.short),
      best_of = excluded.best_of, high_club = coalesce(excluded.high_club, series.high_club), low_club = coalesce(excluded.low_club, series.low_club),
      starts_at = coalesce(excluded.starts_at, series.starts_at), tbd = excluded.tbd, sort = excluded.sort, updated_at = now();
    ns := ns + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'fixtures', '[]')) loop
    select id into hc from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'home';
    select id into ac from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'away';
    if hc is null or ac is null then continue; end if;
    sid := (select id from series where provider = c.provider and ext_id = x->>'series');
    insert into fixtures (sport, competition, provider, ext_id, season, round, gameweek, kickoff, date, home_club, away_club,
      state, status, home_score, away_score, venue, series_id, game_no, detail, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', c.season, x->>'round', nullif(x->>'gameweek', '')::int,
      (x->>'kickoff')::timestamptz, coalesce(nullif(x->>'date', '')::date, ((x->>'kickoff')::timestamptz at time zone c.tz)::date), hc, ac,
      x->>'state', x->>'status', nullif(x->>'home_score', '')::int, nullif(x->>'away_score', '')::int, nullif(left(x->>'venue', 120), ''),
      sid, nullif(x->>'game_no', '')::int, x->'detail', now())
    on conflict (provider, ext_id) do update set round = coalesce(excluded.round, fixtures.round), gameweek = coalesce(excluded.gameweek, fixtures.gameweek),
      kickoff = excluded.kickoff, date = excluded.date, home_club = excluded.home_club, away_club = excluded.away_club,
      state = excluded.state, status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score,
      venue = coalesce(excluded.venue, fixtures.venue), series_id = coalesce(excluded.series_id, fixtures.series_id),
      game_no = coalesce(excluded.game_no, fixtures.game_no), detail = coalesce(excluded.detail, fixtures.detail), updated_at = now()
    returning id into fid;
    for y in select * from jsonb_array_elements(coalesce(x->'periods', '[]')) loop
      insert into fixture_periods (fixture_id, n, home, away) values (fid, (y->>'n')::int, nullif(y->>'home', '')::int, nullif(y->>'away', '')::int)
      on conflict (fixture_id, n) do update set home = excluded.home, away = excluded.away;
    end loop;
    nf := nf + 1;
  end loop;
  -- every series of the competition from its games: wins, the winner once a club has enough, live once a game is played
  for s in select * from series where competition = c.id loop
    need := s.best_of / 2 + 1;
    update series z set
      high_wins = w.hw, low_wins = w.lw,
      winner = case when w.hw >= need then s.high_club when w.lw >= need then s.low_club end,
      state = case when w.hw >= need or w.lw >= need then 'final' when w.played > 0 or w.live > 0 then 'live' else 'scheduled' end,
      starts_at = coalesce(w.first_ko, z.starts_at),
      updated_at = now()
    from (select
            count(*) filter (where f.state = 'final' and ((f.home_club = s.high_club and f.home_score > f.away_score) or (f.away_club = s.high_club and f.away_score > f.home_score)))::int hw,
            count(*) filter (where f.state = 'final' and ((f.home_club = s.low_club and f.home_score > f.away_score) or (f.away_club = s.low_club and f.away_score > f.home_score)))::int lw,
            count(*) filter (where f.state = 'final')::int played,
            count(*) filter (where f.state = 'live')::int live,
            min(f.kickoff) filter (where f.game_no = 1) first_ko
          from fixtures f where f.series_id = s.id) w
    where z.id = s.id and s.high_club is not null and s.low_club is not null
      and (z.high_wins, z.low_wins, z.state, z.winner, z.starts_at) is distinct from
          (w.hw, w.lw, case when w.hw >= need or w.lw >= need then 'final' when w.played > 0 or w.live > 0 then 'live' else 'scheduled' end,
           case when w.hw >= need then s.high_club when w.lw >= need then s.low_club end, coalesce(w.first_ko, z.starts_at));
  end loop;
  -- the squares on this event: draw at the first pitch, pay what the innings say
  perform _squares_tick(c.id);
  return jsonb_build_object('clubs', nc, 'series', ns, 'fixtures', nf);
end $$;
revoke execute on function public.sport_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.sport_ingest(text, jsonb) to service_role;

-- ───────────── the table ─────────────
-- squares: the coins each member's squares have taken, how many payouts and how many squares
create or replace function public._pool_game_table(p_game bigint) returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; fr int; lock_at timestamptz; ws_runs int;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null then return; end if;
  if g.kind = 'squares' then
    return query
    select tm.id::int, coalesce(sum(p.coins), 0)::int, coalesce(sum(p.coins), 0)::int, count(p.id)::int, 0,
      (select count(*) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing like 'sq:%')::int, null::int
    from teams tm left join pool_square_pays p on p.game_id = g.id and p.team_id = tm.id and p.coins > 0
    where tm.league_id = g.league_id and tm.role = 'gm'
    group by tm.id;
    return;
  end if;
  fr := (g.rules->>'from_round')::int;
  -- the final game's total runs, for the tiebreaker
  select f.home_score + f.away_score into ws_runs from fixtures f join series s on s.id = f.series_id
  where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition) and s.state = 'final' and f.state = 'final'
  order by f.kickoff desc limit 1;
  if g.kind = 'series' then
    return query
    with s as (select * from series where competition = g.competition and round >= fr),
    p as (select pk.team_id, s.*, (pk.pick->>'winner')::bigint pw, (pk.pick->>'games')::int pn
          from pool_picks pk join s on pk.thing = 's:' || s.id where pk.game_id = g.id),
    full_value as (select s.id, coalesce((g.rules->'points'->>s.round::text)::int, 1)
                     + case when coalesce((g.rules->>'exact_only')::boolean, false) then 0 else coalesce((g.rules->'length'->>s.round::text)::int, 0) end v
                   from s),
    scored as (
      select p.team_id,
        _series_pick_points(g.rules, p.round, p.pw, p.pn, p.winner, case when p.state = 'final' then p.high_wins + p.low_wins end) pts,
        case when p.state = 'final' then _series_pick_points(g.rules, p.round, p.pw, p.pn, p.winner, p.high_wins + p.low_wins)
             -- still open: the winner's points if that club can still take it, the length too if it can still end that way
             when _series_can_end(p.best_of, case when p.pw = p.high_club then p.high_wins else p.low_wins end,
                                  case when p.pw = p.high_club then p.low_wins else p.high_wins end, null) then
               case when _series_can_end(p.best_of, case when p.pw = p.high_club then p.high_wins else p.low_wins end,
                                         case when p.pw = p.high_club then p.low_wins else p.high_wins end, p.pn)
                    then (select v from full_value fv where fv.id = p.id)
                    when coalesce((g.rules->>'exact_only')::boolean, false) then 0
                    else coalesce((g.rules->'points'->>p.round::text)::int, 1) end
             else 0 end poss,
        (p.state = 'final' and p.pw = p.winner) rt,
        (p.state = 'final' and p.pw = p.winner and p.pn = p.high_wins + p.low_wins) ex
      from p),
    -- a series still open to pick, and not picked yet, is all still possible
    unpicked as (select tm.id team_id, sum(fv.v)::int v from teams tm cross join s join full_value fv on fv.id = s.id
                 where tm.league_id = g.league_id and tm.role = 'gm' and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
                   and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 's:' || s.id)
                 group by tm.id)
    select tm.id::int, coalesce(sum(sc.pts), 0)::int, (coalesce(sum(sc.poss), 0) + coalesce(max(u.v), 0))::int,
      count(*) filter (where sc.rt)::int, count(*) filter (where sc.ex)::int,
      (select count(*) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing like 's:%')::int,
      (select abs((pk.pick->>'runs')::int - ws_runs) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'tiebreak' and ws_runs is not null)::int
    from teams tm left join scored sc on sc.team_id = tm.id left join unpicked u on u.team_id = tm.id
    where tm.league_id = g.league_id and tm.role = 'gm'
    group by tm.id;
  else
    lock_at := _rank_lock(g.id);
    return query
    with mine as (select pk.team_id, pk.pick->'order' ord from pool_picks pk where pk.game_id = g.id and pk.thing = 'rank'),
    vals as (select m.team_id, v.club, v.value from mine m cross join lateral _rank_values(g.id, m.ord) v),
    wins as (select case when f.home_score > f.away_score then f.home_club else f.away_club end club, count(*)::int n
             from fixtures f join series s on s.id = f.series_id
             where s.competition = g.competition and s.round >= fr and f.state = 'final' and lock_at is not null and f.kickoff >= lock_at
             group by 1)
    select tm.id::int,
      coalesce((select sum(v.value * coalesce(w.n, 0)) from vals v left join wins w on w.club = v.club where v.team_id = tm.id), 0)::int,
      (coalesce((select sum(v.value * coalesce(w.n, 0)) from vals v left join wins w on w.club = v.club where v.team_id = tm.id), 0)
       + coalesce((select sum(v.value * _club_wins_left(g.competition, v.club)) from vals v where v.team_id = tm.id), 0)
       + case when not exists (select 1 from mine m where m.team_id = tm.id) and (lock_at is null or lock_at > now()) then
           (select coalesce(sum(x.v * _club_wins_left(g.competition, x.club)), 0) from (
              select c.club, (count(*) over () - row_number() over (order by _club_wins_left(g.competition, c.club) desc) + 1) v
              from (select distinct unnest(array[s.high_club, s.low_club]) club from series s where s.competition = g.competition and s.round = fr) c
              where c.club is not null) x)
         else 0 end)::int,
      0, 0, (select count(*) from mine m where m.team_id = tm.id)::int, null::int
    from teams tm where tm.league_id = g.league_id and tm.role = 'gm';
  end if;
end $$;
revoke execute on function public._pool_game_table(bigint) from public, anon, authenticated;

-- ───────────── reading ─────────────
-- the grid as a member sees it: who has which square (claims are public, the digits stay hidden until the draw), the
-- pot and what each checkpoint pays, every game with its runs by inning and the square leading it, and every payout
create or replace function public._squares_board(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; s series; top_c bigint; side_c bigint; sz int; n int; pot int;
begin
  select * into g from pool_games where id = p_game;
  select * into s from series where id = (g.rules->>'series')::bigint;
  top_c := coalesce((g.draw->>'top')::bigint, s.high_club); side_c := coalesce((g.draw->>'side')::bigint, s.low_club);
  sz := (g.rules->>'size')::int;
  n := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
  pot := coalesce((g.draw->>'pot')::int, n * (g.rules->>'cost')::int);
  return jsonb_build_object(
    'series', jsonb_build_object('id', s.id, 'label', s.label, 'short', s.short, 'best_of', s.best_of, 'state', s.state, 'starts_at', s.starts_at,
      'tbd', s.tbd, 'winner', s.winner,
      'top_wins', case when top_c = s.low_club then s.low_wins else s.high_wins end,
      'side_wins', case when top_c = s.low_club then s.high_wins else s.low_wins end),
    'top', _club_json(top_c), 'side', _club_json(side_c),
    'size', sz, 'cost', (g.rules->>'cost')::int, 'cap', coalesce((g.rules->>'cap')::int, 0), 'pay_when', g.rules->>'pays', 'digits', g.rules->>'digits',
    'points', g.rules->'points', 'weights', g.rules->'weights',
    'locks_at', s.starts_at, 'locked', g.draw is not null or s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()),
    'claimed', n, 'pot', pot,
    'claims', coalesce((select jsonb_agg(jsonb_build_object('cell', thing, 'team_id', team_id) order by thing) from pool_picks where game_id = g.id and thing like 'sq:%'), '[]'),
    'draw', case when g.draw is not null then jsonb_build_object('seed', g.draw->'seed', 'at', g.draw->'at', 'why', g.draw->'why', 'sets', g.draw->'sets') end,
    'games', coalesce((select jsonb_agg(jsonb_build_object('fixture', f.id, 'game_no', f.game_no, 'state', f.state, 'kickoff', f.kickoff, 'detail', f.detail,
        'top_home', f.home_club = top_c,
        'top_runs', case when f.home_club = top_c then f.home_score else f.away_score end,
        'side_runs', case when f.home_club = top_c then f.away_score else f.home_score end,
        'innings', coalesce((select jsonb_agg(jsonb_build_object('n', p.n, 'top', case when f.home_club = top_c then p.home else p.away end,
                     'side', case when f.home_club = top_c then p.away else p.home end) order by p.n) from fixture_periods p where p.fixture_id = f.id), '[]'),
        -- while a game is on, the square its score names right now and who would take it
        'now', case when f.state = 'live' and g.draw is not null and f.home_score is not null then
          (select jsonb_build_object('cell', c.cell, 'to', o.cell, 'team_id', o.team_id)
           from (select _squares_cell(g.draw, sz, f.game_no, case when f.home_club = top_c then f.home_score else f.away_score end,
                                      case when f.home_club = top_c then f.away_score else f.home_score end) cell) c
           left join lateral _squares_owner(g.id, sz, c.cell) o on true) end)
        order by f.game_no)
      from fixtures f where f.series_id = s.id and f.game_no is not null), '[]'),
    'pays', coalesce((select jsonb_agg(jsonb_build_object('game_no', p.game_no, 'point', p.point, 'top_runs', p.top_runs, 'side_runs', p.side_runs,
        'cell', p.cell, 'paid_cell', p.paid_cell, 'team_id', p.team_id, 'coins', p.coins, 'at', p.created_at)
        order by p.game_no, case when p.point = 0 then 99 else p.point end) from pool_square_pays p where p.game_id = g.id), '[]'),
    'paid', coalesce((select sum(coins) from pool_square_pays where game_id = g.id), 0));
end $$;
revoke execute on function public._squares_board(bigint) from public, anon, authenticated;

-- the board of a game: every series (or the ranking, or the grid) with your pick, everyone's once it locks, and the table
create or replace function public.pool_game_board(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; me int := my_team(); fr int; last_r int; lock_at timestamptz; tb_lock timestamptz; out jsonb;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then return null; end if;
  fr := (g.rules->>'from_round')::int;
  select max(round) into last_r from series where competition = g.competition;
  out := jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'rules', g.rules, 'status', g.status, 'winners', to_jsonb(g.winners),
    'competition', g.competition, 'competition_name', (select name from competitions where id = g.competition), 'me', me,
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', r.round, 'label', r.label, 'best_of', r.best_of) order by r.round)
       from (select round, max(regexp_replace(label, '^(AL|NL|AFC|NFC) ', '')) label, max(best_of) best_of from series
             where competition = g.competition and round >= fr group by round) r), '[]'),
    'table', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.team_id, 'points', t.points, 'possible', t.possible, 'right', t.right_calls,
        'exact', t.exact, 'picked', t.picked, 'tiebreak', t.tiebreak) order by t.points desc, t.tiebreak nulls last, t.possible desc, t.picked desc, t.team_id)
      from _pool_game_table(g.id) t), '[]'));
  if g.kind = 'squares' then
    out := out || jsonb_build_object('squares', _squares_board(g.id));
  elsif g.kind = 'series' then
    tb_lock := (select min(starts_at) from series where competition = g.competition and round = last_r);
    out := out || jsonb_build_object(
      'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'round', s.round, 'label', s.label, 'short', s.short, 'best_of', s.best_of,
          'high', _club_json(s.high_club), 'low', _club_json(s.low_club), 'high_wins', s.high_wins, 'low_wins', s.low_wins,
          'winner', s.winner, 'state', s.state, 'starts_at', s.starts_at, 'tbd', s.tbd,
          'locked', s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()),
          'next', (select jsonb_build_object('kickoff', f.kickoff, 'game_no', f.game_no, 'state', f.state, 'home', f.home_club,
                     'home_score', f.home_score, 'away_score', f.away_score, 'detail', f.detail)
                   from fixtures f where f.series_id = s.id and f.state in ('scheduled', 'live') order by (f.state = 'live') desc, f.kickoff limit 1),
          'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 's:' || s.id),
          'points', (select _series_pick_points(g.rules, s.round, (pk.pick->>'winner')::bigint, (pk.pick->>'games')::int, s.winner,
                       case when s.state = 'final' then s.high_wins + s.low_wins end)
                     from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 's:' || s.id and s.state = 'final'),
          -- everyone's picks, once the series has started
          'calls', case when s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then
            coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'winner', (pk.pick->>'winner')::bigint, 'games', (pk.pick->>'games')::int)
                        order by pk.team_id) from pool_picks pk where pk.game_id = g.id and pk.thing = 's:' || s.id), '[]') end,
          'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 's:' || s.id))
        order by s.round, s.sort, s.id)
        from series s where s.competition = g.competition and s.round >= fr), '[]'),
      'tiebreak', jsonb_build_object('locks_at', tb_lock, 'locked', tb_lock is not null and tb_lock <= now(),
        'mine', (select (pk.pick->>'runs')::int from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 'tiebreak'),
        'label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = g.competition and round = last_r)));
  else
    lock_at := _rank_lock(g.id);
    out := out || jsonb_build_object('rank', jsonb_build_object(
      'locks_at', lock_at, 'locked', lock_at is not null and lock_at <= now(),
      'round_label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = g.competition and round = fr),
      'field', (select count(distinct c) from series s, unnest(array[s.high_club, s.low_club]) c where s.competition = g.competition and s.round = fr and c is not null),
      -- the clubs still in (or every club in the event, out ones last), with what each has won since the lock
      'clubs', coalesce((select jsonb_agg(_club_json(c.club) || jsonb_build_object('alive', _club_wins_left(g.competition, c.club) > 0,
            'in_field', c.club in (select unnest(array[s.high_club, s.low_club]) from series s where s.competition = g.competition and s.round = fr),
            'wins', (select count(*) from fixtures f join series s on s.id = f.series_id
                     where s.competition = g.competition and s.round >= fr and f.state = 'final' and lock_at is not null and f.kickoff >= lock_at
                       and c.club = case when f.home_score > f.away_score then f.home_club else f.away_club end),
            'left', _club_wins_left(g.competition, c.club))
          order by (_club_wins_left(g.competition, c.club) > 0) desc, c.club)
        from (select distinct unnest(array[s.high_club, s.low_club]) club from series s where s.competition = g.competition) c where c.club is not null), '[]'),
      'mine', (select pk.pick->'order' from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 'rank'),
      'orders', case when lock_at is not null and lock_at <= now() then
        coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'order', pk.pick->'order') order by pk.team_id)
                  from pool_picks pk where pk.game_id = g.id and pk.thing = 'rank'), '[]') end));
  end if;
  return out;
end $$;
revoke execute on function public.pool_game_board(bigint) from public, anon;
grant execute on function public.pool_game_board(bigint) to authenticated;

-- the pool's games, for its menu and home: what each needs from the caller now (a grid: a square, until it closes)
create or replace function public.pool_games_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'status', g.status, 'competition', g.competition,
      'series', (g.rules->>'series')::bigint,
      'to_pick', case when g.kind = 'series' then
          (select count(*) from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
             and s.high_club is not null and s.low_club is not null and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
             and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 's:' || s.id))
        when g.kind = 'squares' then
          (select case when g.draw is null and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
                         and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing like 'sq:%') then 1 else 0 end
           from series s where s.id = (g.rules->>'series')::bigint)
        else case when (_rank_lock(g.id) is null or _rank_lock(g.id) > now())
                    and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'rank') then 1 else 0 end end,
      'next_lock', case when g.kind = 'series' then
          (select min(s.starts_at) from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
             and s.high_club is not null and s.state = 'scheduled' and s.starts_at > now())
        when g.kind = 'squares' then
          (select s.starts_at from series s where s.id = (g.rules->>'series')::bigint and g.draw is null and s.starts_at > now())
        else (select l from (select _rank_lock(g.id) l) z where l > now()) end)
    order by g.id), '[]')
  from pool_games g where g.league_id = current_league_id()
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;

-- the sports events a new pool can run on today, for the start page (open to anyone): the stage it is at, the kinds of
-- game that can still start with when each locks, and the series a grid of squares can still go on
create or replace function public.pool_events() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(e order by e->>'next_lock'), '[]') from (
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack,
      'stage', (select case when s.state = 'scheduled' then regexp_replace(s.label, '^(AL|NL) ', '') || ' next'
                            else regexp_replace(s.label, '^(AL|NL) ', '') || ' under way' end
                from series s where s.competition = c.id and s.state <> 'final' order by s.round, s.starts_at nulls last limit 1),
      'open_round', r.open_round,
      'open_label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = c.id and round = r.open_round),
      'next_lock', (select min(starts_at) from series where competition = c.id and round = r.open_round),
      'final_round', r.last_round,
      'final_label', (select min(label) from series where competition = c.id and round = r.last_round),
      'final_starts', (select min(starts_at) from series where competition = c.id and round = r.last_round),
      'kinds', jsonb_build_array('series', 'rank'),
      -- squares are offered through their series (the site before squares reads only the kinds)
      'grids', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'round', s.round, 'label', s.label, 'short', s.short, 'best_of', s.best_of,
                  'starts_at', s.starts_at, 'tbd', s.tbd, 'high', (select coalesce(short, name) from clubs where id = s.high_club),
                  'low', (select coalesce(short, name) from clubs where id = s.low_club)) order by s.round desc, s.sort, s.id)
                from series s where s.competition = c.id and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())), '[]')) e
    from competitions c cross join lateral _event_rounds(c.id) r
    where c.active and r.open_round is not null) z
$$;
revoke execute on function public.pool_events() from public;
grant execute on function public.pool_events() to anon, authenticated;

-- ───────────── the reminder, and the hourly draw ─────────────
-- once per member per series (or ranking, or grid) when the lock is under six hours away and they have nothing in
create or replace function public._pool_game_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g pool_games; s record; t record; n int := 0; lk timestamptz; hrs text;
begin
  for g in select * from pool_games where league_id = p_league and status = 'open' loop
    for s in select x.id, x.starts_at, coalesce(x.short, x.label) nm from series x
             where g.kind = 'series' and x.competition = g.competition and x.round >= (g.rules->>'from_round')::int
               and x.high_club is not null and x.low_club is not null and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours'
             union all
             select 0, _rank_lock(g.id), 'ranking' where g.kind = 'rank' and _rank_lock(g.id) between now() and now() + interval '6 hours'
             union all
             select x.id, x.starts_at, 'squares' from series x
             where g.kind = 'squares' and g.draw is null and x.id = (g.rules->>'series')::bigint and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours' loop
      lk := s.starts_at;
      hrs := case when lk - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from lk - now()) / 3600))::int || 'h' end;
      for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
                 and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id
                                 and (case when g.kind = 'squares' then pk.thing like 'sq:%'
                                           else pk.thing = case when s.id = 0 then 'rank' else 's:' || s.id end end))
                 and not exists (select 1 from private.soccer_nudged x where x.game = g.kind and x.game_id = g.id and x.team_id = tm.id and x.gameweek = s.id) loop
        perform _pool_alert(t.id, 'pool_game', case when g.kind = 'squares'
          then format('⏰ %s close in %s. Claim a square before the digits are drawn.', g.title, hrs)
          when s.id = 0 then format('⏰ Rank the teams locks in %s. Put the clubs in order.', hrs)
          else format('⏰ The %s starts in %s. Pick the winner and how many games.', s.nm, hrs) end, '/picks?g=' || g.id);
        insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.kind, g.id, t.id, s.id) on conflict do nothing;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_game_nudge(int) from public, anon, authenticated;

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id())
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
