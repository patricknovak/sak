-- The prop sheet and "if necessary" games (migration 208's follow-up): a postseason keeps a series' later games on the
-- schedule after the series is over (MLB's Game 5 of a division series won in four). The sheet is offered only on games
-- of a series still going, can't be started on one that's over, and a sheet on a game the series didn't need ends with
-- no winner, as a game called off does.

create or replace function public._props_games(p_competition text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'game_no', f.game_no, 'label', coalesce(s.short, s.label),
      'home', coalesce(ch.short, ch.name), 'away', coalesce(ca.short, ca.name)) order by f.kickoff, f.id), '[]')
  from fixtures f join series s on s.id = f.series_id join competitions c on c.id = f.competition
  join clubs ch on ch.id = f.home_club join clubs ca on ca.id = f.away_club
  where f.competition = p_competition and c.sport in ('mlb', 'nfl', 'nhl') and f.state = 'scheduled' and s.state <> 'final'
    and f.kickoff > now() and f.kickoff <= now() + interval '7 days'
$$;
revoke execute on function public._props_games(text) from public, anon, authenticated;


create or replace function public._props_rules(p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f fixtures; r jsonb := coalesce(p_rules, '{}');
begin
  select * into f from fixtures where id = (r->>'fixture')::bigint and competition = p_competition;
  if f.id is null or f.series_id is null then raise exception 'Pick a game of this event'; end if;
  if (select sport from competitions where id = p_competition) not in ('mlb', 'nfl', 'nhl') then raise exception 'Prop sheets run on baseball, football and hockey'; end if;
  if f.state <> 'scheduled' or f.kickoff <= now() then raise exception 'That game has started; pick one still to come'; end if;
  if (select state from series where id = f.series_id) = 'final' then raise exception 'That series is over, so the game won''t be played'; end if;
  -- the sheet stays as it was made while the game is the same (a rules change before the lock keeps its lines)
  return jsonb_build_object('fixture', f.id, 'questions',
    case when (r->>'fixture')::bigint = f.id and jsonb_typeof(r->'questions') = 'array' then r->'questions' else _props_sheet(f.id) end);
end $$;
revoke execute on function public._props_rules(text, jsonb) from public, anon, authenticated;


create or replace function public._props_tick(p_competition text) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; top record; t record; n int := 0; nq int; match text; w int[];
begin
  for g in select pg.* from pool_games pg join fixtures fx on fx.id = (pg.rules->>'fixture')::bigint
           where pg.kind = 'props' and pg.status = 'open' and pg.competition = p_competition
             and (fx.state in ('final', 'cancelled') or (fx.state = 'scheduled' and exists (select 1 from series s where s.id = fx.series_id and s.state = 'final'))) loop
    select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
    match := format('%s at %s', (select coalesce(short, name) from clubs where id = f.away_club), (select coalesce(short, name) from clubs where id = f.home_club));
    if f.state <> 'final' then
      update pool_games set status = 'done', winners = '{}' where id = g.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format(case when f.state = 'cancelled' then '📋 %s was called off, so its prop sheet counts for nobody.'
                    else '📋 The series ended before %s, so its prop sheet counts for nobody.' end, match), jsonb_build_object('pool_game', g.id), g.league_id);
      n := n + 1;
      continue;
    end if;
    nq := jsonb_array_length(g.rules->'questions');
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

