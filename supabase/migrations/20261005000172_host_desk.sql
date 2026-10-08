-- The host's desk for every game (docs/DEVELOPMENT.md §6 item 3, docs/POOL-TYPES.md §3 and §6): what a host needs so a
-- pool runs whatever the feed does.
--
-- * Rules until the first lock: `pool_game_set_rules` changes a game's knobs (the scoring, the last round) and freezes
--   them once anything in the game has locked (a series started, the ranking locked, a square claimed, a pick'em match
--   picked and kicked off). The scoring of a pick'em changes only before anyone picks, since Confidence numbers picks.
-- * A pick for a member who asked: `pool_host_pick` enters a series pick, a ranking or a round of pick'em on a member's
--   behalf, under the same rules and locks as their own, and tells them it was done.
-- * A result the feed missed: `pool_result_set` settles a match for this pool only (a pick'em's home, away, draw, or
--   void), with the reason on the record; the shared match stays as the feed has it, and clearing the override hands it
--   back. The round's result and the game's end follow as if the feed had sent it.
-- * Every one of these is on the commissioner's log, beside the host's other powers.

-- ───────────── a result for this pool only ─────────────
create table if not exists public.pool_result_overrides (
  league_id int not null default current_league_id() references public.leagues (id),
  fixture_id bigint not null references public.fixtures (id),
  outcome text not null check (outcome in ('H', 'D', 'A', 'void')),
  reason text not null,
  by_team int references public.teams (id) on delete set null,
  at timestamptz not null default now(),
  primary key (league_id, fixture_id)
);

do $$ begin
  alter table public.pool_result_overrides enable row level security;
  if not exists (select 1 from pg_policy where polrelid = 'public.pool_result_overrides'::regclass and polname = 'league_read') then
    create policy league_read on public.pool_result_overrides for select to authenticated using (league_id = (select current_league_id()));
  end if;
  -- members may see what the host settled and why
  revoke all on public.pool_result_overrides from anon, authenticated;
  grant select on public.pool_result_overrides to authenticated;
  grant all on public.pool_result_overrides to service_role;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pool_result_overrides'::regclass and tgname = 'pool_result_overrides_stamp_league') then
    create trigger pool_result_overrides_stamp_league before insert on public.pool_result_overrides for each row execute function public._stamp_league();
  end if;
end $$;

-- a match as a pool's pick'em reads it: the host's word if they gave one, else the feed's. `res` is H, A or D once it
-- counts; `void` when it counts for nobody; `open` while it can still be picked; `done` once it no longer waits on
-- anything
create or replace function public._pool_fixture(p_league int, p_fixture bigint)
returns table (res text, void boolean, open boolean, done boolean, by_host boolean, reason text)
language sql stable security definer set search_path = public as $$
  select case when o.outcome in ('H', 'D', 'A') then o.outcome
              when o.outcome is null and f.state = 'final' then _fixture_result(coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score)) end,
    coalesce(o.outcome = 'void', f.state in ('postponed', 'cancelled')),
    o.outcome is null and f.state = 'scheduled' and f.kickoff > now(),
    o.outcome is not null or f.state in ('final', 'postponed', 'cancelled'),
    o.outcome is not null, o.reason
  from fixtures f left join pool_result_overrides o on o.league_id = p_league and o.fixture_id = f.id
  where f.id = p_fixture
$$;
revoke execute on function public._pool_fixture(int, bigint) from public, anon, authenticated;

-- what the commissioner's log keeps: the pool host's powers join the league's
create or replace function public._commish_logged(p_fn text) returns boolean
language sql immutable as $$
  select p_fn = any (array[
    'commish_add_spectator', 'commish_bill_entries', 'commish_coins', 'commish_delete_line', 'commish_fund_entry',
    'commish_fund_price', 'commish_fund_settings', 'commish_market', 'commish_money_line', 'commish_move_player',
    'commish_post_payouts', 'commish_reset_password', 'commish_rule_bet', 'commish_set_brand', 'commish_set_cocommish',
    'commish_set_keeper', 'commish_set_keepers', 'commish_set_login_email', 'commish_set_pick_owner', 'commish_set_spectator',
    'commish_settle_bet', 'commish_settle_market', 'commish_settle_team', 'commish_update_league', 'commish_update_scoring',
    'commish_vacate_seat', 'draft_pause', 'draft_randomize_order', 'draft_reset', 'draft_resume', 'draft_set_order',
    'draft_start', 'draft_undo', 'finalize_keepers', 'rescore_all', 'review_trade', 'close_proposal', 'set_idea_status',
    'commish_set_rules', 'commish_set_season', 'commish_delete_season', 'commish_set_roster', 'commish_set_categories', 'commish_set_format', 'commish_make_schedule',
    'pool_game_start', 'pool_set_crown', 'pool_game_set_rules', 'pool_host_pick', 'pool_result_set'])
$$;


-- ───────────── picking, for yourself or (the host) for a member ─────────────
-- a series pick, a ranking or the tiebreaker, for the team given; the locks are the same whoever enters it
create or replace function public._pool_game_pick_as(p_team int, p_game bigint, p_thing text, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := p_team; s series; w bigint; n int; lock_at timestamptz; ord jsonb; v text; last_r int;
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
    if lock_at is not null and lock_at <= now() then raise exception 'The ranking locked at the first pitch'; end if;
    ord := '[]';
    for v in select jsonb_array_elements_text(coalesce(p_pick->'order', '[]')) loop
      if not exists (select 1 from series where competition = g.competition and v::bigint in (high_club, low_club)) then raise exception 'That club isn''t in this event'; end if;
      if ord @> to_jsonb(v::bigint) then raise exception 'Each club once'; end if;
      ord := ord || to_jsonb(v::bigint);
    end loop;
    if jsonb_array_length(ord) < 2 then raise exception 'Put the clubs in order'; end if;
    p_pick := jsonb_build_object('order', ord);
  elsif p_thing = 'tiebreak' and g.kind = 'series' then
    select max(round) into last_r from series where competition = g.competition;
    lock_at := (select min(starts_at) from series where competition = g.competition and round = last_r);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked at the first pitch of the final round'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and 60 then raise exception 'Total runs: a number from 0 to 60'; end if;
    p_pick := jsonb_build_object('runs', n);
  else
    raise exception 'Nothing to pick there';
  end if;
  insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, p_thing, p_pick)
  on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
  return p_pick;
end $$;
revoke execute on function public._pool_game_pick_as(int, bigint, text, jsonb) from public, anon, authenticated;

-- a member's own pick
create or replace function public.pool_game_pick(p_game bigint, p_thing text, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _in_league('pool_games', p_game);
  return _pool_game_pick_as(_team(), p_game, p_thing, p_pick);
end $$;
revoke execute on function public.pool_game_pick(bigint, text, jsonb) from public, anon;
grant execute on function public.pool_game_pick(bigint, text, jsonb) to authenticated;

-- a round of pick'em for the team given
create or replace function public._pickem_save_as(p_team int, p_game bigint, p_round int, p_picks jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := p_team; x jsonb; f fixtures; v text; cf int; n int; conf boolean; draws boolean; saved int := 0;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null or g.kind <> 'pickem' then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if (select role from teams where id = me) <> 'gm' then raise exception 'Only players pick'; end if;
  if p_round is null or p_round not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then raise exception 'That round isn''t in this game'; end if;
  conf := g.rules->>'preset' = 'confidence'; draws := coalesce((g.rules->>'draws')::boolean, false);
  n := (select count(*) from fixtures where competition = g.competition and gameweek = p_round);
  for x in select * from jsonb_array_elements(coalesce(p_picks, '[]')) loop
    select * into f from fixtures where id = (x->>'fixture')::bigint and competition = g.competition and gameweek = p_round;
    if f.id is null then raise exception 'That match isn''t in this round'; end if;
    if f.state <> 'scheduled' or f.kickoff <= now() then continue; end if;
    v := upper(nullif(x->>'pick', ''));
    if v is null then
      delete from pool_picks where game_id = g.id and team_id = me and thing = 'f:' || f.id;
      continue;
    end if;
    if v not in ('H', 'A', 'D') then raise exception 'Pick the home side, the away side or a draw'; end if;
    if v = 'D' and not draws then raise exception 'There are no draws in this sport'; end if;
    cf := null;
    if conf then
      cf := (x->>'conf')::int;
      if cf is null or cf not between 1 and n then raise exception 'Give each pick a confidence from 1 to %', n; end if;
    end if;
    insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, 'f:' || f.id, jsonb_strip_nulls(jsonb_build_object('pick', v, 'conf', cf)))
    on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
    saved := saved + 1;
  end loop;
  if conf and exists (select 1 from pool_picks pk join fixtures fx on pk.thing = 'f:' || fx.id
                      where pk.game_id = g.id and pk.team_id = me and fx.gameweek = p_round
                      group by pk.pick->>'conf' having count(*) > 1) then
    raise exception 'Use each confidence number once a round';
  end if;
  return saved;
end $$;
revoke execute on function public._pickem_save_as(int, bigint, int, jsonb) from public, anon, authenticated;

-- a member's own round
create or replace function public.pool_pickem_save(p_game bigint, p_round int, p_picks jsonb) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform _in_league('pool_games', p_game);
  return _pickem_save_as(_team(), p_game, p_round, p_picks);
end $$;
revoke execute on function public.pool_pickem_save(bigint, int, jsonb) from public, anon;
grant execute on function public.pool_pickem_save(bigint, int, jsonb) to authenticated;


-- ───────────── pick'em reads the host's word before the feed's ─────────────
create or replace function public._pickem_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  -- each match as this pool reads it: the host's word (migration 172) before the feed's
  fx as (select f.id, f.gameweek, (o.outcome is null and f.state = 'scheduled' and f.kickoff > now()) open,
           coalesce(o.outcome = 'void', f.state in ('postponed', 'cancelled')) void,
           case when o.outcome in ('H', 'D', 'A') then o.outcome
                when o.outcome is null and f.state = 'final' then _fixture_result(coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score)) end res
         from fixtures f cross join g left join pool_result_overrides o on o.league_id = g.league_id and o.fixture_id = f.id
         where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int),
  pk as (select p.team_id, fx.id, fx.gameweek, fx.void, fx.res, p.pick->>'pick' pp,
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
    null::int
  from members m
$$;
revoke execute on function public._pickem_table(bigint) from public, anon, authenticated;

create or replace function public._pickem_board(p_game bigint, p_round int, p_me int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; fr int; tr int; cur int;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null or g.kind <> 'pickem' then return null; end if;
  fr := (g.rules->>'from_round')::int; tr := (g.rules->>'to_round')::int;
  cur := coalesce(p_round, (select min(gameweek) from fixtures where competition = g.competition and gameweek between fr and tr and state in ('scheduled', 'live')), tr);
  cur := greatest(fr, least(tr, cur));
  return jsonb_build_object('round', cur, 'from_round', fr, 'to_round', tr, 'word', _round_word(g.competition),
    'confidence', g.rules->>'preset' = 'confidence', 'draws', coalesce((g.rules->>'draws')::boolean, false),
    'size', (select count(*) from fixtures where competition = g.competition and gameweek = cur),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', x.gw, 'first', x.first, 'last', x.last, 'matches', x.n, 'done', x.done, 'open', x.open,
        'picked', (select count(*) from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw),
        'points', (select coalesce(sum(case when (g.rules->>'preset') = 'confidence' then coalesce((pk.pick->>'conf')::int, 1) else 1 end), 0)
                   from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
                   where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw and pk.pick->>'pick' = e.res))
        order by x.gw)
      from (select gameweek gw, min(kickoff) first, max(kickoff) last, count(*)::int n,
              bool_and(state in ('final', 'postponed', 'cancelled')) done, count(*) filter (where state = 'scheduled' and kickoff > now())::int open
            from fixtures where competition = g.competition and gameweek between fr and tr group by gameweek) x), '[]'),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state, 'minute', f.minute,
        'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'home_score', coalesce(f.home_ft, f.home_score), 'away_score', coalesce(f.away_ft, f.away_score),
        'result', e.res, 'void', e.void,
        -- the host's word on a match the feed got wrong or never finished, and why
        'host', case when e.by_host then jsonb_build_object('reason', e.reason) end,
        'locked', f.state <> 'scheduled' or f.kickoff <= now() or e.by_host,
        'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'f:' || f.id),
        'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id),
        -- the pool's split and everyone's picks, once the match has kicked off (never before: the picks would be a copy)
        'split', case when f.state <> 'scheduled' or f.kickoff <= now() then
            (select jsonb_build_object('H', count(*) filter (where pk.pick->>'pick' = 'H'), 'D', count(*) filter (where pk.pick->>'pick' = 'D'),
                                       'A', count(*) filter (where pk.pick->>'pick' = 'A'))
             from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id) end,
        'calls', case when f.state <> 'scheduled' or f.kickoff <= now() then
            coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'pick', pk.pick->>'pick', 'conf', (pk.pick->>'conf')::int) order by pk.team_id)
                      from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id), '[]') end)
      order by f.kickoff, f.id)
      from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e where f.competition = g.competition and f.gameweek = cur), '[]'));
end $$;
revoke execute on function public._pickem_board(bigint, int, int) from public, anon, authenticated;


-- ───────────── the end of a round, from the feed or from the host ─────────────
-- once every match of a pick'em's round is over or settled by the host, the pool hears who won the round and each picker
-- how they did; the last round ends the game and names its winner. Each round is announced once.
create or replace function public._pickem_round(p_game bigint, p_round int) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; top record; lead record; word text; last_left boolean; t record; w text;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null or g.kind <> 'pickem' or g.status <> 'open' or p_round is null or p_round::bigint = any (g.posted)
     or p_round not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then return; end if;
  if exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
             where f.competition = g.competition and f.gameweek = p_round and not e.done) then return; end if;
  word := _round_word(g.competition);
  w := case when g.rules->>'preset' = 'confidence' then 'conf' end;
  -- the round's best, on that round's picks alone
  select string_agg(x.gm_name, ' and ' order by x.gm_name) names, max(x.pts) pts into top
  from (select tm.gm_name, sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) pts,
               rank() over (order by sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) desc) rk
        from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
        join teams tm on tm.id = pk.team_id
        where pk.game_id = g.id and f.gameweek = p_round and pk.pick->>'pick' = e.res
        group by tm.id, tm.gm_name) x where x.rk = 1;
  select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t2.points) pts into lead
  from _pickem_table(g.id) t2 join teams tm on tm.id = t2.team_id
  where t2.points = (select max(points) from _pickem_table(g.id)) and t2.points > 0;
  update pool_games set posted = posted || p_round::bigint where id = g.id;
  last_left := p_round >= (g.rules->>'to_round')::int
    or not exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
                   where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int and not e.done);
  if last_left then
    update pool_games set status = 'done', winners = array(select t2.team_id from _pickem_table(g.id) t2
      where t2.points = (select max(points) from _pickem_table(g.id)) and t2.points > 0) where id = g.id;
    if lead.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 %s is done: %s, with %s %s.', g.title, lead.names, lead.pts, case when lead.pts = 1 then 'point' else 'points' end),
        jsonb_build_object('pool_game', g.id, 'round', p_round), g.league_id);
    end if;
  elsif top.names is not null then
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      format('✅ %s %s is done in %s. Top of the %s: %s with %s %s. Leading: %s on %s.', word, p_round, g.title, lower(word), top.names, top.pts,
             case when top.pts = 1 then 'point' else 'points' end, lead.names, lead.pts),
      jsonb_build_object('pool_game', g.id, 'round', p_round), g.league_id);
  end if;
  -- each member hears how their round went
  for t in select pk.team_id id, count(pk.id) picked, count(pk.id) filter (where pk.pick->>'pick' = e.res) rt,
             coalesce(sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) filter (where pk.pick->>'pick' = e.res), 0) pts
           from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id and f.gameweek = p_round
           cross join lateral _pool_fixture(g.league_id, f.id) e
           where pk.game_id = g.id group by pk.team_id loop
    perform _pool_alert(t.id, 'pool_game',
      case when top.names is not null and t.pts = top.pts then format('🏅 You won %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end)
           else format('✅ %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end) end,
      '/picks?g=' || g.id);
  end loop;
end $$;
revoke execute on function public._pickem_round(bigint, int) from public, anon, authenticated;

-- a match ends (or is called off, or corrected): every open pick'em on its competition looks at that round
create or replace function public._pickem_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if new.gameweek is null or new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  for g in select pg.id from pool_games pg where pg.kind = 'pickem' and pg.status = 'open' and pg.competition = new.competition loop
    perform _pickem_round(g.id, new.gameweek);
  end loop;
  return new;
end $$;
revoke execute on function public._pickem_settle_fixture() from public, anon, authenticated;

-- ───────────── the host's desk ─────────────
-- has anything in this game locked yet? (a series started, the ranking locked, a square claimed or the digits drawn, a
-- pick'em pick on a match that has kicked off)
create or replace function public._pool_game_locked(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case g.kind
    when 'series' then exists (select 1 from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
                               and (s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now())))
    when 'rank' then coalesce(_rank_lock(g.id) <= now(), false)
    when 'squares' then g.draw is not null or exists (select 1 from pool_picks pk where pk.game_id = g.id)
    when 'pickem' then exists (select 1 from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id
                               where pk.game_id = g.id and (f.state <> 'scheduled' or f.kickoff <= now()))
    else true end
  from pool_games g where g.id = p_game
$$;
revoke execute on function public._pool_game_locked(bigint) from public, anon, authenticated;

-- the host changes a game's knobs before its first lock: the new ones over the old, checked as when it started; where it
-- starts (its first round, a grid's series) stays put. A pick'em's scoring changes only before anyone picks.
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
  if g.kind = 'pickem' and coalesce(p_rules->>'preset', g.rules->>'preset') <> g.rules->>'preset'
     and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Picks are in, so the scoring stays: it changes only before anyone picks';
  end if;
  -- what was worked out from a preset is worked out again from the new one
  base := g.rules - 'points' - 'length' - 'exact_only' - 'weights' - 'draws' - 'per';
  r := _pool_game_rules(g.kind, g.competition, base || coalesce(p_rules, '{}')
         || jsonb_strip_nulls(jsonb_build_object('from_round', g.rules->'from_round', 'series', g.rules->'series')));
  update pool_games set rules = r where id = g.id;
  perform _sys('general', format('📝 The host changed the rules of %s before the first lock.', g.title), jsonb_build_object('pool_game', g.id));
  return r;
end $$;
revoke execute on function public.pool_game_set_rules(bigint, jsonb) from public, anon;
grant execute on function public.pool_game_set_rules(bigint, jsonb) to authenticated;

-- the host enters a pick for a member who asked: a pick'em round ({round, picks}) or a series pick, the ranking or the
-- tiebreaker ({thing, pick}), under the member's own locks. Squares stay each player's own, being bought with coins.
create or replace function public.pool_host_pick(p_game bigint, p_team int, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; out jsonb;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if not exists (select 1 from teams where id = p_team and league_id = current_league_id() and role = 'gm') then
    raise exception 'Pick for a player in this pool';
  end if;
  if g.kind = 'pickem' then
    out := to_jsonb(_pickem_save_as(p_team, g.id, (p_pick->>'round')::int, p_pick->'picks'));
  elsif g.kind in ('series', 'rank') then
    out := _pool_game_pick_as(p_team, g.id, p_pick->>'thing', p_pick->'pick');
  else
    raise exception 'Squares are claimed by each player, with their own coins';
  end if;
  if p_team <> my_team() then
    perform _pool_alert(p_team, 'pool_game', format('📝 The host entered a pick for you in %s.', g.title), '/picks?g=' || g.id);
  end if;
  return out;
end $$;
revoke execute on function public.pool_host_pick(bigint, int, jsonb) from public, anon;
grant execute on function public.pool_host_pick(bigint, int, jsonb) to authenticated;

-- the host settles a pick'em match for this pool: the home side, the away side, a draw, or void (it counts for nobody),
-- with the reason; null hands it back to the feed. Only a match that has kicked off (or been called off), and only for
-- this pool: the shared match stays as the feed has it.
create or replace function public.pool_result_set(p_game bigint, p_fixture bigint, p_outcome text, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; v text := upper(nullif(trim(p_outcome), '')); hn text; an text;
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
  insert into pool_result_overrides (fixture_id, outcome, reason, by_team) values (f.id, v, left(trim(p_reason), 200), my_team())
  on conflict (league_id, fixture_id) do update set outcome = excluded.outcome, reason = excluded.reason, by_team = excluded.by_team, at = now();
  select name into hn from clubs where id = f.home_club;
  select name into an from clubs where id = f.away_club;
  perform _sys('general', format('📝 The host settled %s v %s in %s: %s. %s', hn, an, g.title,
    case v when 'H' then hn || ' win' when 'A' then an || ' win' when 'D' then 'a draw' else 'void, it counts for nobody' end, left(trim(p_reason), 200)),
    jsonb_build_object('pool_game', g.id, 'fixture', f.id));
  perform _pickem_round(g.id, f.gameweek);
  return v;
end $$;
revoke execute on function public.pool_result_set(bigint, bigint, text, text) from public, anon;
grant execute on function public.pool_result_set(bigint, bigint, text, text) to authenticated;
