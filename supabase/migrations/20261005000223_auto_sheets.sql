-- Prop sheets on every game, automatically (docs/POOL-TYPES.md §9 item 3): a host turns it on for an event once, and the
-- hourly pool job opens a sheet on each of its games a day and a half before it starts (any game the pool has no sheet
-- on yet), so a World Series pool needn't open one by hand for every game. The setting is the pool's own
-- (`pool_auto_sheets`, one row an event), changed by the host with `pool_auto_sheets_set`, which opens the ones due at
-- once. Safe to run twice.

create table if not exists public.pool_auto_sheets (
  league_id int not null default current_league_id() references public.leagues (id),
  competition text not null references public.competitions (id),
  by_team int references public.teams (id) on delete set null,
  at timestamptz not null default now(),
  primary key (league_id, competition)
);

do $$ begin
  alter table public.pool_auto_sheets enable row level security;
  if not exists (select 1 from pg_policy where polrelid = 'public.pool_auto_sheets'::regclass and polname = 'league_read') then
    create policy league_read on public.pool_auto_sheets for select to authenticated using (league_id = (select current_league_id()));
  end if;
  -- members may see that the host turned it on; only the host's function changes it
  revoke all on public.pool_auto_sheets from anon, authenticated;
  grant select on public.pool_auto_sheets to authenticated;
  grant all on public.pool_auto_sheets to service_role;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pool_auto_sheets'::regclass and tgname = 'pool_auto_sheets_stamp_league') then
    create trigger pool_auto_sheets_stamp_league before insert on public.pool_auto_sheets for each row execute function public._stamp_league();
  end if;
end $$;

-- a sheet on each game of the pool's automatic events that starts within 36 hours and has none yet; one that can't open
-- is a warning, never a stopped job
create or replace function public._props_auto(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare a record; x jsonb; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for a in select s.competition from pool_auto_sheets s join competitions c on c.id = s.competition
           where s.league_id = p_league and c.active order by s.competition loop
    for x in select * from jsonb_array_elements(_props_games(a.competition)) loop
      continue when (x->>'kickoff')::timestamptz > now() + interval '36 hours';
      continue when exists (select 1 from pool_games where league_id = p_league and kind = 'props' and (rules->>'fixture')::bigint = (x->>'id')::bigint);
      begin
        perform _pool_game_create('props', a.competition, jsonb_build_object('fixture', (x->>'id')::bigint));
        n := n + 1;
      exception when others then
        raise warning 'automatic sheet on % for league %: %', x->>'id', p_league, sqlerrm;
      end;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._props_auto(int) from public, anon, authenticated;

-- the host turns automatic sheets on or off for an event; on opens the ones already due
create or replace function public.pool_auto_sheets_set(p_competition text, p_on boolean) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if not exists (select 1 from competitions where id = p_competition and active) then raise exception 'No such event'; end if;
  if not p_on then
    delete from pool_auto_sheets where league_id = current_league_id() and competition = p_competition;
    return 0;
  end if;
  if (select sport from competitions where id = p_competition) not in ('mlb', 'nfl', 'nba', 'nhl') then
    raise exception 'Prop sheets run on baseball, football, basketball and hockey';
  end if;
  insert into pool_auto_sheets (competition, by_team) values (p_competition, my_team()) on conflict do nothing;
  return _props_auto(current_league_id());
end $$;
revoke execute on function public.pool_auto_sheets_set(text, boolean) from public, anon;
grant execute on function public.pool_auto_sheets_set(text, boolean) to authenticated;

-- the hourly pool job opens the automatic sheets too
create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _props_auto(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
