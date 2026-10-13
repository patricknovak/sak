-- A closing time the host set by hand stays theirs (migration 258 moved a pack question's later date onto every open
-- copy, which would also undo a host who closed one early): pool_edit marks a copy whose closing time the host changed
-- (source.host_closes), and the pack refresh leaves marked copies alone. pool_edit is as migration 145 left it but for
-- the mark; _pool_pack_refresh as migration 258 left it but for the skip.
create or replace function public.pool_edit(p_market bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m pool_markets; traded boolean;
begin
  perform _in_league('pool_markets', p_market);
  perform _commish();
  select * into m from pool_markets where id = p_market for update;
  if m.status <> 'open' then raise exception 'That question is settled'; end if;
  traded := exists (select 1 from pool_trades where market_id = p_market);
  if traded and (p ? 'title' or p ? 'rule') and (coalesce(p->>'title', m.title) <> m.title or coalesce(p->>'rule', m.rule) <> m.rule) then
    raise exception 'People have traded on it, so the question and its rule stay as they are';
  end if;
  update pool_markets set
    title = coalesce(nullif(left(btrim(p->>'title'), 160), ''), title),
    rule = coalesce(left(btrim(p->>'rule'), 600), rule),
    category = case when p ? 'category' then nullif(left(btrim(p->>'category'), 40), '') else category end,
    closes_at = coalesce(nullif(p->>'closes_at', '')::timestamptz, closes_at),
    -- a closing time the host set by hand is theirs: the pack's dates leave it alone from then on (migration 259)
    source = case when nullif(p->>'closes_at', '') is not null then coalesce(source, '{}'::jsonb) || '{"host_closes": true}'::jsonb else source end,
    sort = coalesce(nullif(p->>'sort', '')::int, sort)
  where id = p_market;
end $$;

create or replace function public._pool_pack_refresh(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare pslug text; n int; total int := 0; names text; t record; pname text; mv record;
begin
  for pslug in select distinct m.pack from pool_markets m where m.league_id = p_league and m.pack is not null
               and exists (select 1 from pool_packs p where p.slug = m.pack) loop
    -- a pack question's closing time moved later (the reunion's date, once Netflix names it): every open copy that
    -- still closes earlier moves with it, said once in the chat; a copy the host moved later than the pack keeps its own
    for mv in select m.id, m.title, (x->>'closes_at')::timestamptz as at
              from pool_packs p cross join lateral jsonb_array_elements(p.markets) x
              join pool_markets m on m.league_id = p_league and m.pack = p.slug and m.title = x->>'title'
              where p.slug = pslug and m.status = 'open' and m.closes_at > now() and m.closes_at < (x->>'closes_at')::timestamptz
                and not coalesce((m.source->>'host_closes')::boolean, false) loop
      update pool_markets set closes_at = mv.at where id = mv.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('📅 "%s" now closes %s', mv.title, to_char(mv.at at time zone 'America/New_York', 'FMDy FMMon FMDD, FMHH12:MI am ET')),
        jsonb_build_object('pool_market', mv.id, 'moved', true), p_league);
      total := total + 1;
    end loop;
    n := _pool_load_pack(p_league, pslug, null);
    if n = 0 then continue; end if;
    total := total + n;
    select name into pname from pool_packs where slug = pslug;
    select string_agg(format('"%s"', title), ' · ' order by sort, id) into names
      from (select title, sort, id from pool_markets where league_id = p_league and pack = pslug order by id desc limit n) q;
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      format('🔮 %s new question%s from %s: %s', n, case when n = 1 then '' else 's' end, pname, names),
      jsonb_build_object('pool_pack', pslug, 'added', n), p_league);
    for t in select id from teams where league_id = p_league and role = 'gm' and user_id is not null loop
      perform _pool_alert(t.id, 'pool_new', format('🔮 %s new question%s to call from %s', n, case when n = 1 then '' else 's' end, pname), '/questions');
    end loop;
  end loop;
  return total;
end $$;
