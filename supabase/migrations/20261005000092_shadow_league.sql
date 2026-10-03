-- The shadow league: Phase 1's gate (docs/EXPANSION.md, section 7). A copy of a league's teams, owned by nobody,
-- whose rosters and lineups follow the original minute by minute. It runs through every per-league path (the
-- league pass, its own scoring profile, its own Book and Garry) and its standings must come out exactly as the
-- original's: any difference is a tenancy bug.
--
--   * open_shadow_league(source, slug) makes it: the source's rules (so the same scoring profile), a team per
--     source GM team (teams.perms.shadow_of names the original), the same rosters, active from the start.
--   * shadow_sync() copies every shadow team's roster and slots from its original; the scheduler runs it every
--     minute (the _cron file), so a lineup set before puck drop is mirrored before the snapshot.
--   * shadow_report(shadow) lays each day's points side by side, original and shadow, with the difference.
-- Judge it from its first full day: on the day it opens, the snapshot job backfills it for games already under way
-- with the lineups as they stand then. Nobody signs in to a shadow team; the league exists for the comparison and can be archived (status 'archived')
-- when the gate has passed.

set client_min_messages = warning;

create or replace function public.open_shadow_league(p_source int default 1, p_slug text default 'shadow') returns integer
language plpgsql security definer set search_path = public as $$
declare src leagues; nid int; t record; tid int;
begin
  select * into src from leagues where id = p_source;
  if src.id is null then raise exception 'No league %', p_source; end if;
  if exists (select 1 from leagues where slug = p_slug) then raise exception 'That web name is taken'; end if;
  insert into leagues (slug, name, short_name, brand, status, sport, owner_user)
  values (p_slug, src.name || ' (shadow)', src.short_name, src.brand || '{"shadow": true}'::jsonb, 'active', src.sport, src.owner_user)
  returning id into nid;
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, keeper_deadline, draft_at, pick_seconds,
    draft_rounds, snake, season_start, season_end, trade_deadline, trade_review_hours, max_acquisitions, extra_acq_fee, entry_fee, sak_fee,
    prize_split, roster, scoring, info, playoff_share, playoffs_end, cup_share, playoff_bonus_acq)
  select nid, nid, r.name || ' (shadow)', r.short_name, r.season, r.phase, r.keepers, r.top_scorer_rule, r.keeper_deadline, r.draft_at, r.pick_seconds,
    r.draft_rounds, r.snake, r.season_start, r.season_end, r.trade_deadline, r.trade_review_hours, r.max_acquisitions, r.extra_acq_fee, r.entry_fee, r.sak_fee,
    r.prize_split, r.roster, r.scoring, r.info, r.playoff_share, r.playoffs_end, r.cup_share, r.playoff_bonus_acq
  from league_rules r where r.league_id = p_source;
  insert into garry_state (league_id) values (nid) on conflict (league_id) do nothing;
  perform _draft_row(nid);
  for t in select * from teams where league_id = p_source and role = 'gm' order by id loop
    insert into teams (name, abbrev, gm_name, league_id, role, is_commish, joined_season, auto_lineup, auto_mode, color, emoji, perms)
    values (t.name, t.abbrev, t.gm_name, nid, 'gm', t.is_commish, t.joined_season, false, 'off', t.color, t.emoji,
            jsonb_build_object('shadow_of', t.id))
    returning id into tid;
    insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance (shadow league)');
  end loop;
  perform shadow_sync();
  return nid;
end $$;
revoke execute on function public.open_shadow_league(int, text) from public, anon, authenticated;

-- every shadow team's roster and slots, copied from its original
create or replace function public.shadow_sync() returns integer
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  -- players the original no longer has
  delete from rosters r using teams s
  where s.id = r.team_id and s.perms ? 'shadow_of'
    and not exists (select 1 from rosters o where o.team_id = (s.perms->>'shadow_of')::int and o.player_id = r.player_id);
  get diagnostics k = row_count; n := n + k;
  -- players the original has, in the original's slot (a player traded between originals moves between shadows)
  insert into rosters (league_id, player_id, team_id, slot, acquired, acquired_at, keeper, prev_fp, pin)
  select s.league_id, o.player_id, s.id, o.slot, o.acquired, o.acquired_at, o.keeper, o.prev_fp, o.pin
  from teams s join rosters o on o.team_id = (s.perms->>'shadow_of')::int
  where s.perms ? 'shadow_of'
  on conflict (league_id, player_id) do update set team_id = excluded.team_id, slot = excluded.slot, acquired = excluded.acquired,
    acquired_at = excluded.acquired_at, keeper = excluded.keeper, prev_fp = excluded.prev_fp, pin = excluded.pin
  where (rosters.team_id, rosters.slot) is distinct from (excluded.team_id, excluded.slot);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function public.shadow_sync() from public, anon, authenticated;

-- each day's points, original against shadow, read the way each league's own standings read them
create or replace function public.shadow_report(p_shadow int) returns table (date date, team text, original numeric, shadow numeric, diff numeric)
language plpgsql security definer set search_path = public as $$
declare prev text := current_setting('app.league_id', true); src int;
begin
  select (perms->>'shadow_of')::int into src from teams where league_id = p_shadow and perms ? 'shadow_of' limit 1;
  if src is null then raise exception 'League % is not a shadow league', p_shadow; end if;
  create temp table if not exists _shadow_pts (league int, team_id int, date date, points numeric) on commit drop;
  truncate _shadow_pts;
  perform set_config('app.league_id', (select league_id from teams where id = src)::text, true);
  insert into _shadow_pts select current_league_id(), d.team_id, d.date, sum(d.points) from team_daily_all d
    where d.team_id in (select id from teams where league_id = current_league_id()) group by d.team_id, d.date;
  perform set_config('app.league_id', p_shadow::text, true);
  insert into _shadow_pts select p_shadow, d.team_id, d.date, sum(d.points) from team_daily_all d
    where d.team_id in (select id from teams where league_id = p_shadow) group by d.team_id, d.date;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return query
    with m as (select st.id as sid, t.id as oid, t.name from teams st join teams t on t.id = (st.perms->>'shadow_of')::int
               where st.league_id = p_shadow),
    days as (select distinct x.date from _shadow_pts x)
    select d.date, m.name, coalesce(o.points, 0), coalesce(sh.points, 0), coalesce(sh.points, 0) - coalesce(o.points, 0)
    from m cross join days d
    left join _shadow_pts o on o.team_id = m.oid and o.date = d.date
    left join _shadow_pts sh on sh.team_id = m.sid and sh.date = d.date
    order by 1, 2;
end $$;
revoke execute on function public.shadow_report(int) from public, anon, authenticated;
