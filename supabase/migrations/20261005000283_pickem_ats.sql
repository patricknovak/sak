-- Pick'em against the spread (docs/POOL-TYPES.md §2.4, 15 October 2026): the knob every NFL office pool asks for, and
-- now the NBA's and the NHL's weeks too. A pick'em started (or changed before anyone picks) with `ats` makes every pick
-- a side with the market's line: the home side's spread from ESPN's lines (`fixtures.detail.odds.line`, minus when the
-- home side is favoured), read at the moment the pick is saved and kept with it while it stays on that side, so a line
-- that moves later never changes a pick already made. A pick is right when its side covers its own line; landing on the
-- number is a push, which counts for nobody. A game with no line yet is an even one (a line of 0). Sports with draws
-- stay straight up. The host's result on a match settles who covered. The crowd's pick split stays a straight-up
-- forecast, so these pools leave it out of the prediction log; each pick's chance in "what you need to win" is a coin flip.

-- which side covered a line (the home side's): H, A, or P for a push
create or replace function public._ats_side(p_home int, p_away int, p_line numeric) returns text
language sql immutable as $$
  select case when p_home is null or p_away is null then null
              when p_home + coalesce(p_line, 0) > p_away then 'H' when p_home + coalesce(p_line, 0) < p_away then 'A' else 'P' end
$$;

-- a pick's result as its game reads it: straight up, the match's result; against the spread, whether the pick's own line
-- was covered (the host's word, when they gave one, says who covered)
create or replace function public._pick_res(p_rules jsonb, p_pick jsonb, p_res text, p_by_host boolean, p_home int, p_away int) returns text
language sql immutable as $$
  select case when coalesce(p_rules->>'ats', 'false') <> 'true' or p_res is null or coalesce(p_by_host, false) then p_res
              else _ats_side(p_home, p_away, (p_pick->>'line')::numeric) end
$$;

create or replace function public._pickem_rules(p_competition text, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ev record; fr int; tr int; preset text; draws boolean; ats boolean;
begin
  draws := coalesce((select (s.config->>'draws')::boolean from competitions c join sports s on s.id = c.sport where c.id = p_competition), false);
  -- against the spread: each pick is on a side with the market's line at the moment it is made; a sport with draws
  -- (soccer) plays its own handicaps, so it stays straight up
  ats := coalesce((r->>'ats')::boolean, false);
  if ats and draws then raise exception 'Against the spread is for sports without draws'; end if;
  select * into ev from _pickem_rounds(p_competition);
  if ev.last_round is null then raise exception 'That event has no rounds yet'; end if;
  if ev.open_round is null then raise exception 'Every round of that event has started'; end if;
  fr := coalesce((r->>'from_round')::int, ev.open_round);
  if fr < ev.open_round then raise exception 'That round is over; start from the next one'; end if;
  tr := coalesce((r->>'to_round')::int, ev.last_round);
  if fr > ev.last_round or tr < fr or tr > ev.last_round then raise exception 'No such round'; end if;
  preset := coalesce(r->>'preset', 'classic');
  if preset not in ('classic', 'confidence') then raise exception 'Pick a scoring: Classic or Confidence'; end if;
  return jsonb_build_object('preset', preset, 'from_round', fr, 'to_round', tr, 'draws', draws)
    || case when ats then '{"ats": true}'::jsonb else '{}'::jsonb end;
end $$;

create or replace function public._pickem_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  -- each match as this pool reads it: the host's word (migration 172) before the feed's
  fx as (select f.id, f.gameweek, (o.outcome is null and f.state = 'scheduled' and f.kickoff > now()) open, o.outcome is not null by_host,
           coalesce(f.home_ft, f.home_score) h, coalesce(f.away_ft, f.away_score) a,
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
    null::int
  from members m
$$;

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
    'ats', coalesce((g.rules->>'ats')::boolean, false),
    'size', (select count(*) from fixtures where competition = g.competition and gameweek = cur),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', x.gw, 'first', x.first, 'last', x.last, 'matches', x.n, 'done', x.done, 'open', x.open,
        'picked', (select count(*) from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw),
        'points', (select coalesce(sum(case when (g.rules->>'preset') = 'confidence' then coalesce((pk.pick->>'conf')::int, 1) else 1 end), 0)
                   from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
                   where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw
                     and pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))))
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
        -- against the spread: the home side's line now (what a pick made now is made at), and what my pick's own line
        -- made of the result
        'line', case when g.rules->>'ats' = 'true' then coalesce((f.detail->'odds'->>'line')::numeric, 0) end,
        'mine_res', case when g.rules->>'ats' = 'true' then (select _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))
                                                            from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'f:' || f.id) end,
        'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id),
        -- the pool's split and everyone's picks, once the match has kicked off (never before: the picks would be a copy)
        'split', case when f.state <> 'scheduled' or f.kickoff <= now() then
            (select jsonb_build_object('H', count(*) filter (where pk.pick->>'pick' = 'H'), 'D', count(*) filter (where pk.pick->>'pick' = 'D'),
                                       'A', count(*) filter (where pk.pick->>'pick' = 'A'))
             from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id) end,
        'calls', case when f.state <> 'scheduled' or f.kickoff <= now() then
            coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('team_id', pk.team_id, 'pick', pk.pick->>'pick', 'conf', (pk.pick->>'conf')::int,
                        'line', (pk.pick->>'line')::numeric)) order by pk.team_id)
                      from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id), '[]') end)
      order by f.kickoff, f.id)
      from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e where f.competition = g.competition and f.gameweek = cur), '[]'));
end $$;

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
        where pk.game_id = g.id and f.gameweek = p_round and pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))
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
  for t in select pk.team_id id, count(pk.id) picked, count(pk.id) filter (where pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))) rt,
             coalesce(sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) filter (where pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))), 0) pts
           from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id and f.gameweek = p_round
           cross join lateral _pool_fixture(g.league_id, f.id) e
           where pk.game_id = g.id group by pk.team_id loop
    perform _pool_alert(t.id, 'pool_game',
      case when top.names is not null and t.pts = top.pts then format('🏅 You won %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end)
           else format('✅ %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end) end,
      '/picks?g=' || g.id);
  end loop;
end $$;

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
    -- against the spread a pick is made at the home side's line of the moment (none yet is an even game), and keeps it
    -- while it stays on the same side
    insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, 'f:' || f.id, jsonb_strip_nulls(jsonb_build_object('pick', v, 'conf', cf,
      'line', case when g.rules->>'ats' = 'true' then coalesce((f.detail->'odds'->>'line')::numeric, 0) end)))
    on conflict (game_id, team_id, thing) do update set picked_at = now(),
      pick = case when pool_picks.pick->>'pick' = excluded.pick->>'pick' and pool_picks.pick ? 'line'
                  then excluded.pick || jsonb_build_object('line', pool_picks.pick->'line') else excluded.pick end;
    saved := saved + 1;
  end loop;
  if conf and exists (select 1 from pool_picks pk join fixtures fx on pk.thing = 'f:' || fx.id
                      where pk.game_id = g.id and pk.team_id = me and fx.gameweek = p_round
                      group by pk.pick->>'conf' having count(*) > 1) then
    raise exception 'Use each confidence number once a round';
  end if;
  return saved;
end $$;

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
  -- each match's chances: the market's at kick-off where the feed carries a line (migration 178), else the pool's split
  -- with one more pick on every side
  -- against the spread each pick is on a line set to make it even: a coin flip either way
  pr as (select x.fid,
           coalesce(case when (select rules->>'ats' = 'true' from g) then 0.5 end, case when (o->>'home') is not null then (o->>'home')::numeric / ((o->>'home')::numeric + (o->>'away')::numeric
                                                                                     + case when (select n from k) = 3 then coalesce((o->>'draw')::numeric, 0) else 0 end) end, x.ph) ph,
           coalesce(case when (o->>'home') is not null and (select n from k) = 3 then coalesce((o->>'draw')::numeric, 0)
                           / ((o->>'home')::numeric + (o->>'away')::numeric + coalesce((o->>'draw')::numeric, 0)) end, x.pd) pd
         from (select fx.id fid,
                 (count(pk.side) filter (where pk.side = 'H') + 1.0) / (count(pk.side) + (select n from k)) ph,
                 case when (select n from k) = 3 then (count(pk.side) filter (where pk.side = 'D') + 1.0) / (count(pk.side) + 3) else 0 end pd
               from fx left join pk on pk.fid = fx.id group by fx.id) x
         left join lateral (select fi.detail->'odds' o from fixtures fi where fi.id = x.fid) m on true),
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

create or replace function public._pool_split_write(p_game bigint, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; h int; d int; a int; n int; top int; fav text;
begin
  select * into g from pool_games where id = p_game and kind in ('pickem', 'streak');
  select * into f from fixtures where id = p_fixture;
  -- a pick against the spread is a call on the line, not on who wins: the crowd's forecast of the winner is the
  -- straight-up pools' (migration 283)
  if g.rules->>'ats' = 'true' then return; end if;
  if g.id is null or f.id is null or f.competition <> g.competition
     or (g.kind = 'pickem' and f.gameweek not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int) then return; end if;
  -- pick'em's picks are by match; the streak's by day, each naming its game (migration 235)
  select count(*) filter (where pick->>'pick' = 'H'), count(*) filter (where pick->>'pick' = 'D'), count(*) filter (where pick->>'pick' = 'A')
    into h, d, a from pool_picks
  where game_id = g.id and case when g.kind = 'streak' then thing like 'd:%' and (pick->>'fixture')::bigint = f.id else thing = 'f:' || f.id end;
  n := h + d + a;
  top := greatest(h, d, a);
  if n < 3 or (h = top)::int + (d = top)::int + (a = top)::int > 1 then return; end if;
  fav := case when h = top then 'H' when a = top then 'A' else 'D' end;
  insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
  values (g.league_id, 'pool_split', jsonb_build_object('game', g.id, 'fixture', f.id), round(top::numeric / n, 3), f.sport,
    least(f.kickoff, now()), f.date,
    jsonb_build_object('fav', fav, 'H', h, 'D', d, 'A', a, 'picks', n, 'competition', f.competition, 'round', f.gameweek,
      -- what the market gave the pool's favourite at kick-off, when the feed carries it
      'market', case fav when 'H' then f.detail->'odds'->'home' when 'A' then f.detail->'odds'->'away' else f.detail->'odds'->'draw' end))
  on conflict (league_id, kind, subject) do nothing;
end $$;

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
  -- the scoring and against the spread change only before anyone picks: Confidence numbers picks, and a pick against
  -- the spread carries its line
  if g.kind = 'pickem' and (coalesce(p_rules->>'preset', g.rules->>'preset') <> g.rules->>'preset'
                            or coalesce(p_rules->>'ats', g.rules->>'ats', 'false') <> coalesce(g.rules->>'ats', 'false'))
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
