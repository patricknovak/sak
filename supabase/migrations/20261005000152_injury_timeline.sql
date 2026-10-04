-- How long a player is out, from the injury report the site already reads (nhl-sync?task=injuries, ESPN, hourly):
-- the expected return date, what the injury is (body part, side, surgery), the list he is on (IR, long-term IR,
-- non-roster IR) and the full write-up. No new outside calls: these come in the same response as the status.
alter table public.players add column if not exists injury_return date;
alter table public.players add column if not exists injury_part text;
alter table public.players add column if not exists injury_list text;
alter table public.players add column if not exists injury_detail text;

comment on column public.players.injury_return is 'expected return date from the injury report (an estimate; ESPN moves it as news comes in)';
comment on column public.players.injury_part is 'what the injury is: body part, side, surgery (e.g. "Knee, left")';
comment on column public.players.injury_list is 'the list he is on, as the report names it: IR, IR-LT (long-term), IR-NR (non-roster), OUT, Day-To-Day';
comment on column public.players.injury_detail is 'the report''s full write-up; the site reads it only when a player''s card is opened';

-- the league's view of players carries them too (added at the end, so the view keeps its columns in place)
create or replace view public.league_players with (security_invoker = true) as
  select p.id, p.name, p.first, p.last_name, p.pos, p.elig, p.nhl_team, p.num, p.birth, p.shoots, p.headshot,
    coalesce(v.last_fp, 0::numeric) as last_fp, p.last_stats, coalesce(v.proj, 0::numeric) as proj, v.rank,
    p.status, p.injury_note, p.updated_at, p.injury_status, p.injury_date, p.proj_stats, p.proj_gp, p.proj_meta,
    p.injury_return, p.injury_part, p.injury_list, p.injury_detail
  from players p
  left join player_values v on v.player_id = p.id and v.profile_id = (select current_profile_id());
revoke all on public.league_players from anon;
grant select on public.league_players to authenticated, service_role;
