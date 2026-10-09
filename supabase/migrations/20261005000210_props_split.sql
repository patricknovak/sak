-- The prop sheet in the prediction log (docs/DEVELOPMENT.md §4 and §6 item 5): each call on a sheet is a forecast from
-- its pool, like a pick'em match's split (migration 174) and a series' (205). Once the game starts, each call with three
-- sheets or more and one favourite answer writes `pool_split` (the favourite and its share, made at the start); when
-- the game is final it is scored on the call's answer (void when the score can't settle it, or the game is called off).
-- `crowd_calibration()` reads it with the rest, by sport.

-- the pool's split on each call of a sheet, written once
create or replace function public._props_split_write(p_game bigint) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; q jsonb; top record; n int; k int := 0;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  if g.id is null or f.id is null then return 0; end if;
  for q in select * from jsonb_array_elements(g.rules->'questions') loop
    select count(*) into n from pool_picks where game_id = g.id and thing = 'props' and pick->'answers' ? (q->>'key');
    select x.v, x.c, count(*) over (partition by x.c) ties into top from (
      select pick->'answers'->>(q->>'key') v, count(*) c from pool_picks where game_id = g.id and thing = 'props' group by 1) x
    order by x.c desc limit 1;
    if n < 3 or top.ties > 1 then continue; end if;
    insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
    values (g.league_id, 'pool_split', jsonb_build_object('game', g.id, 'call', q->>'key'), round(top.c::numeric / n, 3), f.sport,
      least(f.kickoff, now()), f.date + 1,
      jsonb_build_object('fav', top.v, 'picks', n, 'options', jsonb_array_length(q->'options'), 'competition', f.competition, 'fixture', f.id, 'q', q->>'q'))
    on conflict (league_id, kind, subject) do nothing;
    k := k + 1;
  end loop;
  return k;
end $$;
revoke execute on function public._props_split_write(bigint) from public, anon, authenticated;

create or replace function public._props_tick(p_competition text) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; top record; t record; n int := 0; nq int; match text; w int[];
begin
  -- a sheet under way: the pool's split on each call goes in the log, once (made at the start)
  for g in select pg.* from pool_games pg join fixtures fx on fx.id = (pg.rules->>'fixture')::bigint
           where pg.kind = 'props' and pg.status = 'open' and pg.competition = p_competition and (fx.state <> 'scheduled' or fx.kickoff <= now()) loop
    perform _props_split_write(g.id);
  end loop;
  for g in select pg.* from pool_games pg join fixtures fx on fx.id = (pg.rules->>'fixture')::bigint
           where pg.kind = 'props' and pg.status = 'open' and pg.competition = p_competition
             and (fx.state in ('final', 'cancelled') or (fx.state = 'scheduled' and exists (select 1 from series s where s.id = fx.series_id and s.state = 'final'))) loop
    select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
    match := format('%s at %s', (select coalesce(short, name) from clubs where id = f.away_club), (select coalesce(short, name) from clubs where id = f.home_club));
    if f.state <> 'final' then
      update predictions set status = 'void', scored_at = now() where kind = 'pool_split' and (subject->>'game')::bigint = g.id and status = 'open';
      update pool_games set status = 'done', winners = '{}' where id = g.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format(case when f.state = 'cancelled' then '📋 %s was called off, so its prop sheet counts for nobody.'
                    else '📋 The series ended before %s, so its prop sheet counts for nobody.' end, match), jsonb_build_object('pool_game', g.id), g.league_id);
      n := n + 1;
      continue;
    end if;
    nq := jsonb_array_length(g.rules->'questions');
    -- each call's split is scored on its answer; one the score couldn't settle is void
    update predictions p set status = case when a.v is null then 'void' else 'scored' end,
      outcome = case when a.v is not null then (a.v = p.detail->>'fav')::int end,
      error = case when a.v is not null then (a.v = p.detail->>'fav')::int - p.predicted end, scored_at = now()
    from (select key, value v from jsonb_each_text(_props_answers(g.id))) a
    where p.kind = 'pool_split' and (p.subject->>'game')::bigint = g.id and p.subject->>'call' = a.key and p.status = 'open';
    select max(points) pts into top from _props_table(g.id) where picked = 1;
    update pool_games set status = 'done', winners = coalesce(array(
        select x.team_id from _props_table(g.id) x where x.picked = 1 and x.points = top.pts
          and coalesce(x.tiebreak, 999) = (select min(coalesce(y.tiebreak, 999)) from _props_table(g.id) y where y.picked = 1 and y.points = top.pts)
          and top.pts > 0), '{}')
    where id = g.id;
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      case when top.pts > 0 then format('📋 The prop sheet on %s is done: %s, with %s of %s right.', match,
        (select string_agg(tm.gm_name, ' and ' order by tm.gm_name) from pool_games x join teams tm on tm.id = any (x.winners) where x.id = g.id), top.pts, nq)
      else format('📋 The prop sheet on %s is done, and nobody called one right.', match) end,
      jsonb_build_object('pool_game', g.id), g.league_id);
    w := (select winners from pool_games where id = g.id);
    for t in select x.team_id, x.points from _props_table(g.id) x where x.picked = 1 loop
      perform _pool_alert(t.team_id, 'pool_game', format('📋 %s: you called %s of %s.%s', match, t.points, nq,
        case when t.team_id = any (w) then ' You won the sheet.' else '' end), '/picks?g=' || g.id);
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._props_tick(text) from public, anon, authenticated;

