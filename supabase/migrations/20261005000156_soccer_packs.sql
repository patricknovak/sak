-- Soccer pools that work today (docs/POOLS.md section 7, P3): two question packs a host settles from what happens, so a
-- group can start a Premier League or MLS Cup pool from #/new tonight. They need no match data; the matchweek questions
-- and the survivor pool, which do, come once the API-Football key is set. Clubs and the table as of 5 October 2026
-- (Premier League matchweek 5; MLS with its regular season nearly done).
--
-- A pack's brand can carry an icon and a line about it for the start page (pool_pack_list), next to its name and size.
insert into public.pool_packs (slug, name, brand, markets, drops) values ('premier-league-2026-27', 'Premier League 2026-27',
  '{"tagline": "A Premier League pool", "trophy": "The Title", "booby": "The Drop Zone", "icon": "⚽",
    "blurb": "The title, the drop and the Golden Boot, called all season, with coins every month",
    "coin": {"name": "Coins", "emoji": "🪙"}, "bot": {"name": "Gaffer", "emoji": "🎙️"}, "colors": {"gold": "#c4b5fd"}}'::jsonb,
  '[
    {"title": "Who wins the Premier League?", "category": "The title", "sort": 1,
     "rule": "The club top of the Premier League table when the 2026-27 season ends. Anyone else covers every club not named.",
     "outcomes": ["Manchester City", "Arsenal", "Liverpool", "Chelsea", "Newcastle United", "Manchester United", "Brighton & Hove Albion", "Anyone else"],
     "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "How many points does the champion finish on?", "category": "The title", "sort": 2,
     "rule": "The champion''s points total in the final 2026-27 Premier League table.",
     "outcomes": ["84 or fewer", "85 to 89", "90 to 94", "95 or more"], "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "Who finishes bottom?", "category": "The drop", "sort": 10,
     "rule": "The club 20th in the final 2026-27 Premier League table. Anyone else covers every club not named.",
     "outcomes": ["Tottenham Hotspur", "Fulham", "Coventry City", "AFC Bournemouth", "Sunderland", "Ipswich Town", "Hull City", "Anyone else"],
     "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "How many of the promoted clubs stay up?", "category": "The drop", "sort": 11,
     "rule": "Of Coventry City, Hull City and Ipswich Town, how many finish 17th or higher in the final table.",
     "outcomes": ["None", "One", "Two", "All three"], "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "Which promoted club finishes highest?", "category": "The drop", "sort": 12,
     "rule": "The highest placed of Coventry City, Hull City and Ipswich Town in the final table.",
     "outcomes": ["Coventry City", "Hull City", "Ipswich Town"], "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "Are Tottenham relegated?", "category": "The drop", "sort": 13,
     "rule": "Yes if Tottenham Hotspur finish 18th, 19th or 20th in the final table.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "How many goals win the Golden Boot?", "category": "The season", "sort": 20,
     "rule": "The Premier League goals of the season''s top scorer (or joint top scorers), as the league counts them.",
     "outcomes": ["22 or fewer", "23 to 26", "27 to 30", "31 or more"], "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "Do Liverpool finish above Manchester United?", "category": "The season", "sort": 21,
     "rule": "Yes if Liverpool are higher than Manchester United in the final table.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-05-30T14:00:00Z"},
    {"title": "Do Manchester City and Arsenal finish first and second?", "category": "The season", "sort": 22,
     "rule": "Yes if the final table has Manchester City and Arsenal in the top two places, either way round.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-05-30T14:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-11-01T12:00:00Z", "amount": 250, "note": "November"},
    {"at": "2026-12-01T12:00:00Z", "amount": 250, "note": "December"},
    {"at": "2027-01-01T12:00:00Z", "amount": 250, "note": "January"},
    {"at": "2027-02-01T12:00:00Z", "amount": 250, "note": "February"},
    {"at": "2027-03-01T12:00:00Z", "amount": 250, "note": "March"},
    {"at": "2027-04-01T12:00:00Z", "amount": 250, "note": "April"},
    {"at": "2027-05-01T12:00:00Z", "amount": 250, "note": "The run-in"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();

insert into public.pool_packs (slug, name, brand, markets, drops) values ('mls-cup-2026', 'MLS Cup 2026',
  '{"tagline": "An MLS Cup pool", "trophy": "The Cup", "booby": "The Wooden Spoon", "icon": "🏆",
    "blurb": "Who lifts MLS Cup on 18 December, called through the playoffs",
    "coin": {"name": "Coins", "emoji": "🪙"}, "bot": {"name": "Gaffer", "emoji": "🎙️"}, "colors": {"gold": "#34d399"}}'::jsonb,
  '[
    {"title": "Who wins MLS Cup?", "category": "The Cup", "sort": 1,
     "rule": "The winner of the 2026 MLS Cup final. Anyone else covers every club not named. Closes at the final; the host moves the time if the kick-off moves.",
     "outcomes": ["Nashville SC", "Vancouver Whitecaps", "St. Louis CITY SC", "Inter Miami CF", "New England Revolution", "FC Dallas", "San Jose Earthquakes", "Houston Dynamo FC", "Charlotte FC", "LAFC", "Anyone else"],
     "closes_at": "2026-12-18T17:00:00Z"},
    {"title": "Which conference wins MLS Cup?", "category": "The Cup", "sort": 2,
     "rule": "The conference of the club that wins the 2026 MLS Cup final.",
     "outcomes": ["Eastern", "Western"], "closes_at": "2026-12-18T17:00:00Z"},
    {"title": "Does Inter Miami reach the final?", "category": "The Cup", "sort": 3,
     "rule": "Yes if Inter Miami CF play in the 2026 MLS Cup final.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-12-18T17:00:00Z"},
    {"title": "How many goals in the final?", "category": "The final", "sort": 10,
     "rule": "Goals in the 2026 MLS Cup final after extra time, not counting a penalty shootout.",
     "outcomes": ["0 or 1", "2", "3", "4 or more"], "closes_at": "2026-12-18T17:00:00Z"},
    {"title": "Does the final go to penalties?", "category": "The final", "sort": 11,
     "rule": "Yes if the 2026 MLS Cup final is decided by a penalty shootout.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-12-18T17:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-11-01T12:00:00Z", "amount": 250, "note": "The playoffs"},
    {"at": "2026-12-01T12:00:00Z", "amount": 250, "note": "The conference finals"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();

-- the start page's list: each pack's icon and line join its name, size and colour
drop function if exists public.pool_pack_list();
create function public.pool_pack_list() returns table (slug text, name text, questions int, color text, icon text, blurb text)
language sql stable security definer set search_path = public as $$
  select p.slug, p.name, coalesce(jsonb_array_length(p.markets), 0), p.brand #>> '{colors,gold}', p.brand ->> 'icon', p.brand ->> 'blurb'
  from pool_packs p order by p.name
$$;
grant execute on function public.pool_pack_list() to anon, authenticated;

-- Love Is Blind's pack gets its icon and line too
update public.pool_packs set brand = brand || '{"icon": "💍", "blurb": "Every episode night called with your friends, with coins on every drop"}'::jsonb
where slug = 'love-is-blind-s11' and not (brand ? 'icon');
