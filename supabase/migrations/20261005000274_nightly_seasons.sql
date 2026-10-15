-- The NHL and NBA regular seasons as pool events (15 October 2026). Until now a pool could play the NHL only as a box
-- pool and the NBA only in its playoffs; the sports a group follows every night had no pick'em, no last one standing and
-- no daily streak. Each season is a competition played in weeks on ESPN's daily scoreboard (soccer-sync's daily pull,
-- `detail.week1` the Monday of opening week): every game is filed in its week, Monday to Sunday, so weekly pick'em and
-- last one standing have their rounds, and the daily streak has a game every night. The NBA opens on 20 October.

-- a competition can carry its own word for a round: these seasons play in weeks, while the NBA's playoffs keep "Round"
create or replace function public._round_word(p_competition text) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from series where competition = p_competition) then 'Round'
    else coalesce((select coalesce(c.detail->>'round_word', s.config->'words'->>'round') from competitions c join sports s on s.id = c.sport
                   where c.id = p_competition), 'Round') end
$$;
revoke execute on function public._round_word(text) from public, anon, authenticated;

-- a hockey game always has a winner (overtime, then the shootout, which ESPN counts in the score), so its pools never
-- offer a draw; and it is a game, in a week
update public.sports set config = jsonb_set(jsonb_set(config, '{draws}', 'false'), '{words,match}', '"game"')
where id = 'nhl' and (config->'draws' is null or config->'words'->'match' is null);

-- and ESPN's game states beside the NHL's own (FUT, LIVE, FINAL...), which SaK's games keep using: without them a hockey
-- game from ESPN that hasn't started ('NS') was read as under way
update public.sports sp set config = jsonb_set(sp.config, '{states}', (
  select jsonb_object_agg(k, (select jsonb_agg(distinct v) from (
           select jsonb_array_elements_text(coalesce(sp.config->'states'->k, '[]')) v
           union select jsonb_array_elements_text(coalesce(e.config->'states'->k, '[]'))) x))
  from (select distinct jsonb_object_keys(sp.config->'states') k union select distinct jsonb_object_keys(e.config->'states')) ks))
from public.sports e
where sp.id = 'nhl' and e.id = 'nba' and not (sp.config->'states'->'scheduled' ? 'NS');

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort, format, detail)
values
  ('nhl-2026-27', 'nhl', 'NHL 2026-27', 'NHL', 'USA', 'America/New_York', '2026-27', 'espn', 'hockey/nhl', '2027', true, 3, 'rounds',
   '{"week1": "2026-09-28", "round_word": "Week"}'),
  ('nba-2026-27', 'nba', 'NBA 2026-27', 'NBA', 'USA', 'America/New_York', '2026-27', 'espn', 'basketball/nba', '2027', true, 4, 'rounds',
   '{"week1": "2026-10-19", "round_word": "Week"}')
on conflict (id) do nothing;
