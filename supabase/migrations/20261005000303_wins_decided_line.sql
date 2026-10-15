-- Win totals all season: each line decided (a club past its line, or one that can't reach it now) is told in the pool's
-- chat by the hourly job, in one line per run with how many called it (`rules.told` keeps the ones already told). Safe
-- to run twice.

create or replace function public._wins_tick(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; n int := 0; top int; w int[]; names text; lk timestamptz; np int; nc int; sure text; split text; told jsonb;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games where league_id = p_league and kind = 'wins' and status = 'open' loop
    lk := _wins_lock(g.id);
    continue when lk is null or lk > now();
    -- the lock is kept from here on, and the pool hears how it split, once
    if not g.rules ? 'locked_at' then
      update pool_games set rules = rules || jsonb_build_object('locked_at', lk) where id = g.id;
      select count(*), coalesce(sum((select count(*) from jsonb_object_keys(pk.pick->'calls'))), 0) into np, nc
        from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins';
      if np > 0 then
        -- the surest call (the most players on one side of a line) and the line that split the pool most
        select format('%s %s %s (%s of %s)', coalesce(c.short, c.name), case when x.o >= x.u then 'over' else 'under' end, x.line, greatest(x.o, x.u), x.o + x.u)
          into sure from (select k.key, k.value::numeric line,
                            count(*) filter (where pk.pick->'calls'->>k.key = 'O') o, count(*) filter (where pk.pick->'calls'->>k.key = 'U') u
                          from jsonb_each_text(g.rules->'lines') k join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
                          group by k.key, k.value) x join clubs c on c.id = x.key::bigint
          where x.o + x.u >= 2 order by greatest(x.o, x.u)::numeric / (x.o + x.u) desc, x.o + x.u desc, x.line desc limit 1;
        select format('%s at %s (%s over, %s under)', coalesce(c.short, c.name), x.line, x.o, x.u)
          into split from (select k.key, k.value::numeric line,
                             count(*) filter (where pk.pick->'calls'->>k.key = 'O') o, count(*) filter (where pk.pick->'calls'->>k.key = 'U') u
                           from jsonb_each_text(g.rules->'lines') k join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
                           group by k.key, k.value) x join clubs c on c.id = x.key::bigint
          where x.o > 0 and x.u > 0 order by abs(x.o - x.u), x.o + x.u desc, x.line desc limit 1;
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🔒 Win totals are locked: %s %s made %s calls.%s%s Everyone''s calls are on the board.',
            np, case when np = 1 then 'player' else 'players' end, nc,
            case when sure is not null then format(' The surest: %s.', sure) else '' end,
            case when split is not null then format(' Split down the middle: %s.', split) else '' end),
          jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
    end if;
    insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
    select g.league_id, 'pool_wins_split', jsonb_build_object('game', g.id, 'club', s.key::bigint), round(s.o::numeric / (s.o + s.u), 3),
      (select sport from competitions where id = g.competition), lk,
      coalesce((select max(f.date) from fixtures f where f.competition = g.competition), today_et() + 200),
      jsonb_build_object('line', s.value::numeric, 'O', s.o, 'U', s.u, 'competition', g.competition)
    from (select x.key, x.value, count(*) filter (where pk.pick->'calls'->>x.key = 'O') o, count(*) filter (where pk.pick->'calls'->>x.key = 'U') u
          from jsonb_each_text(g.rules->'lines') x left join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
          group by x.key, x.value) s
    where s.o + s.u > 0
    on conflict (league_id, kind, subject) do nothing;
    -- every line decided since the last run, told once, in one line: who went over, who can't get there, and how many
    -- called it
    select string_agg(case when c.decided = 'P' then format('%s right on %s, a push', cl.name, c.line)
             else format('%s %s %s, %s of %s called it', cl.name, case c.decided when 'O' then 'over' else 'under' end, c.line,
               (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls'->>c.club::text = c.decided),
               (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls' ? c.club::text)) end,
             '; ' order by c.line desc),
           coalesce(jsonb_agg(to_jsonb(c.club::text)), '[]')
      into names, told
      from _wins_clubs(g.id) c join clubs cl on cl.id = c.club
      where c.decided is not null and not coalesce(g.rules->'told', '[]') ? c.club::text;
    if names is not null then
      update pool_games set rules = rules || jsonb_build_object('told', coalesce(rules->'told', '[]') || told) where id = g.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('📈 Decided in win totals: %s.', names), jsonb_build_object('pool_game', g.id), g.league_id);
    end if;
    continue when exists (select 1 from _wins_clubs(g.id) c where c.decided is null);
    select max(t.points) into top from _pool_game_table(g.id) t;
    select coalesce(array_agg(t.team_id order by t.team_id), '{}') into w from _pool_game_table(g.id) t where t.points = top and top > 0;
    update pool_games set status = 'done', winners = w where id = g.id and status = 'open';
    continue when not found;
    -- each line's split scored: 1 when it went over, 0 under, void on a push
    update predictions p set outcome = case c.decided when 'O' then 1 when 'U' then 0 end,
      error = case c.decided when 'O' then 1 - p.predicted when 'U' then 0 - p.predicted end,
      status = case when c.decided = 'P' then 'void' else 'scored' end, scored_at = now()
    from _wins_clubs(g.id) c
    where p.league_id = g.league_id and p.kind = 'pool_wins_split' and p.subject = jsonb_build_object('game', g.id, 'club', c.club) and p.status = 'open';
    select string_agg(tm.gm_name, ' and ' order by tm.gm_name) into names from teams tm where tm.id = any (w);
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      case when names is null then '📈 Win totals are settled, and nobody called one right.'
           else format('🏆 Win totals are settled: %s called %s of %s right.', names, top, (select count(*) from jsonb_object_keys(g.rules->'lines'))) end,
      jsonb_build_object('pool_game', g.id), g.league_id);
    n := n + 1;
  end loop;
  return n;
end $$;
