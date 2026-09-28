-- Stat corrections: every change to a finished game's line is logged, and the GMs who had that player in the
-- lineup are told how their total moved. The weekly deep re-check (nhl-sync?task=corrections&days=21) catches
-- the rare late corrections the daily three-day pass misses.
create table if not exists public.stat_corrections (
  id bigserial primary key,
  game_id bigint not null references public.games on delete cascade,
  player_id int not null,
  date date not null,
  old_stats jsonb not null,
  new_stats jsonb not null,
  old_fpts numeric not null,
  new_fpts numeric not null,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists stat_corrections_new_idx on public.stat_corrections (notified, id);
alter table public.stat_corrections enable row level security;
revoke all on public.stat_corrections from anon, authenticated;
grant select on public.stat_corrections to authenticated;
grant all on public.stat_corrections to service_role;
drop policy if exists read_all on public.stat_corrections;
create policy read_all on public.stat_corrections for select to authenticated using (true);

-- a line changing after its game was already final is a correction (live games change every minute: not those)
create or replace function public._log_correction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fpts is distinct from old.fpts and exists (select 1 from games g where g.id = new.game_id and g.final_synced) then
    insert into stat_corrections (game_id, player_id, date, old_stats, new_stats, old_fpts, new_fpts)
    values (new.game_id, new.player_id, new.date, old.stats, new.stats, old.fpts, new.fpts);
  end if;
  return new;
end $$;
drop trigger if exists player_games_correction on public.player_games;
create trigger player_games_correction after update of stats on public.player_games
  for each row execute function public._log_correction();

-- "A +1, SOG −1": what changed in a line, in plain stat labels
create or replace function public._stat_diff(o jsonb, n jsonb) returns text
language sql immutable as $$
  select coalesce(string_agg(format('%s %s%s', upper(k), case when d > 0 then '+' else '' end, d), ', ' order by k), 'points recalculated')
  from (select k, coalesce((n->>k)::numeric, 0) - coalesce((o->>k)::numeric, 0) as d
        from (select jsonb_object_keys(o) k union select jsonb_object_keys(n)) keys) x
  where d <> 0
$$;

-- tell each GM whose starter's points moved, once per correction run, then mark the corrections done
create or replace function public.notify_corrections() returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in
    select s.team_id,
      round(sum(c.new_fpts - c.old_fpts), 2) as delta,
      string_agg(format('%s %s%s (%s, %s)', (select name from players where id = c.player_id), case when c.new_fpts >= c.old_fpts then '+' else '' end,
        round(c.new_fpts - c.old_fpts, 2), _stat_diff(c.old_stats, c.new_stats), to_char(c.date, 'Mon DD')), '; ' order by c.id) as what
    from stat_corrections c
    join lineup_snapshots s on s.game_id = c.game_id and s.player_id = c.player_id and s.slot not in ('BN', 'IR')
    where not c.notified and c.new_fpts <> c.old_fpts
    group by s.team_id
  loop
    perform _notify(t.team_id, 'correction', format('📝 Stat correction%s: %s. Your total %s%s.',
      case when position(';' in t.what) > 0 then 's' else '' end, t.what, case when t.delta >= 0 then '+' else '' end, t.delta), '/standings');
    n := n + 1;
  end loop;
  update stat_corrections set notified = true where not notified;
  return n;
end $$;
revoke execute on function public.notify_corrections(), public._log_correction(), public._stat_diff(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.notify_corrections() to service_role;
