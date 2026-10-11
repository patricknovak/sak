-- The Traitors: New Blood (NBC, Thursdays 8 pm ET; the day after on Peacock), a question pack a group can start from
-- #/new tonight (docs/DEVELOPMENT.md §8.4: the winter question packs). The season of 22 civilians premiered on 17
-- September 2026 and runs to a two-hour finale on 19 November: episode 6 on 15 October, 7 on 22 October, 8 on 29
-- October, 9 on 5 November, 10 on 12 November. Every question is about what the show airs from episode 6 on, with no
-- player named, so the pack holds wherever the season stands; the host settles each from what aired. Each episode's
-- question closes as it goes on air (8 pm Eastern: midnight UTC until 1 November, 1 am after), and a coin drop lands
-- the morning of every episode.
insert into public.pool_packs (slug, name, brand, markets, drops) values ('traitors-new-blood', 'The Traitors: New Blood',
  '{"tagline": "A Traitors pool", "trophy": "The Prize Pot", "booby": "The Banished", "icon": "🗡️",
    "blurb": "Every round table called with your friends, with coins on every episode night",
    "wordmark": {"a": "ROUND", "b": "TABLE"},
    "coin": {"name": "Gold", "emoji": "🪙"}, "bot": {"name": "Cloak", "emoji": "🗡️"}, "colors": {"gold": "#c084fc"}}'::jsonb,
  '[
    {"title": "Does a Traitor win the money?", "category": "The finale", "sort": 1,
     "rule": "Yes if a player who is a Traitor when the game ends takes the prize, alone or shared. Closes as the finale goes on air.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-20T01:00:00Z"},
    {"title": "How many players share the prize?", "category": "The finale", "sort": 2,
     "rule": "The number of players the show names as winners of the prize in the finale.",
     "outcomes": ["One", "Two", "Three or more"], "closes_at": "2026-11-20T01:00:00Z"},
    {"title": "How many players reach the final round table?", "category": "The finale", "sort": 3,
     "rule": "The players still in the game when the finale''s last round table begins.",
     "outcomes": ["Three or fewer", "Four", "Five or more"], "closes_at": "2026-11-20T01:00:00Z"},
    {"title": "How many Traitors are still in when the finale starts?", "category": "The finale", "sort": 4,
     "rule": "The Traitors in the game at the start of the finale, as the show reveals them by the end of it.",
     "outcomes": ["None", "One", "Two", "Three or more"], "closes_at": "2026-11-20T01:00:00Z"},
    {"title": "Is a Faithful banished at the final round table?", "category": "The finale", "sort": 5,
     "rule": "Yes if the finale''s last round table banishes at least one Faithful.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-20T01:00:00Z"},
    {"title": "Is a new Traitor recruited from episode 6 on?", "category": "The season", "sort": 10,
     "rule": "Yes if the show airs a Faithful recruited or blackmailed into becoming a Traitor in episodes 6 to 10.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-16T00:00:00Z"},
    {"title": "Episode 6: does the round table banish a Traitor?", "category": "Episode nights", "sort": 20,
     "rule": "Yes if a player banished at a round table in episode 6 (15 October) is revealed as a Traitor. No round table in the episode counts as No.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-16T00:00:00Z"},
    {"title": "Episode 7: does the round table banish a Traitor?", "category": "Episode nights", "sort": 21,
     "rule": "Yes if a player banished at a round table in episode 7 (22 October) is revealed as a Traitor. No round table in the episode counts as No.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-23T00:00:00Z"},
    {"title": "Episode 8: does the round table banish a Traitor?", "category": "Episode nights", "sort": 22,
     "rule": "Yes if a player banished at a round table in episode 8 (29 October) is revealed as a Traitor. No round table in the episode counts as No.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-30T00:00:00Z"},
    {"title": "Episode 9: does the round table banish a Traitor?", "category": "Episode nights", "sort": 23,
     "rule": "Yes if a player banished at a round table in episode 9 (5 November) is revealed as a Traitor. No round table in the episode counts as No.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-06T01:00:00Z"},
    {"title": "Episode 10: does the round table banish a Traitor?", "category": "Episode nights", "sort": 24,
     "rule": "Yes if a player banished at a round table in episode 10 (12 November) is revealed as a Traitor. No round table in the episode counts as No.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-13T01:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-10-15T12:00:00Z", "amount": 250, "note": "Episode 6"},
    {"at": "2026-10-22T12:00:00Z", "amount": 200, "note": "Episode 7"},
    {"at": "2026-10-29T12:00:00Z", "amount": 200, "note": "Episode 8"},
    {"at": "2026-11-05T12:00:00Z", "amount": 200, "note": "Episode 9"},
    {"at": "2026-11-12T12:00:00Z", "amount": 200, "note": "Episode 10"},
    {"at": "2026-11-19T12:00:00Z", "amount": 300, "note": "The finale"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();
