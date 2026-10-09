-- March Madness (docs/DEVELOPMENT.md §6 item 7): the men's tournament as a series competition the bracket runs on.
-- soccer-sync fills it from ESPN's scoreboard day by day through the tournament (`espnTournamentPayload` in
-- `_shared/soccer.ts`): 63 single-game series, every slot there from the start, each round in bracket order (the seed
-- pairs within a region, the regions in Final Four order), so a bracket opens on the first round once all 64 teams are
-- set (after the First Four). The Final Four's pairing of regions goes on the competition when the field is announced
-- (`competitions.detail.regions`, set by a platform admin with `platform_set_regions`); until it is, the Final Four
-- games pair them once drawn. College basketball gets its sport row and words, and a tiebreaker up to 300 points.

insert into public.sports (id, name, config)
select 'ncaab', 'College basketball', s.config || jsonb_build_object(
  'name', 'College basketball',
  'draws', false,
  'day', jsonb_build_object('tz', 'America/New_York', 'rollover', '06:00'),
  'season', jsonb_build_object('games', 31, 'playoffs', true, 'starterGames', 31),
  'words', jsonb_build_object('rec', 'pickup', 'club', 'team', 'game', 'basketball', 'room', 'locker room', 'start', 'tip-off',
    'score', 'points', 'period', 'half', 'voice', 'a bracket-obsessed office regular who has filled one in every March since grade school',
    'centre', 'Tournament centre', 'round', 'Round', 'match', 'game'),
  'periods', jsonb_build_object('1H', '1st half', 'HT', 'Half-time', '2H', '2nd half', 'OT', 'Overtime'))
from public.sports s where s.id = 'nfl'
on conflict (id) do nothing;

alter table public.competitions add column if not exists detail jsonb;

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort, format)
values ('ncaam-2027', 'ncaab', 'March Madness 2027', 'NCAA', 'USA', 'America/New_York', '2027', 'espn', 'basketball/mens-college-basketball', '2027', true, 3, 'series')
on conflict (id) do nothing;

-- the most a tiebreaker can be: a basketball game runs to 300 points between the two sides
create or replace function public._score_cap(p_competition text) returns int
language sql stable security definer set search_path = public as $$
  select case when (select sport from competitions where id = p_competition) in ('ncaab', 'nba') then 300
              else case _sport_word(p_competition, 'score', 'runs') when 'runs' then 60 when 'points' then 150 else 30 end end
$$;
revoke execute on function public._score_cap(text) from public, anon, authenticated;

-- the Final Four's pairing of regions, in order (the first two meet, the last two meet), set when the field is announced
create or replace function public.platform_set_regions(p_competition text, p_regions text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  if not exists (select 1 from competitions where id = p_competition and format = 'series') then raise exception 'No such tournament'; end if;
  if cardinality(p_regions) <> 4 or (select count(distinct r) from unnest(p_regions) r) <> 4 then raise exception 'Name the four regions, each once'; end if;
  update competitions set detail = coalesce(detail, '{}') || jsonb_build_object('regions', to_jsonb(p_regions)) where id = p_competition;
  return (select detail from competitions where id = p_competition);
end $$;
revoke execute on function public.platform_set_regions(text, text[]) from public, anon;
grant execute on function public.platform_set_regions(text, text[]) to authenticated;
