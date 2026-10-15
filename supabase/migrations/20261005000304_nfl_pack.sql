-- The NFL's 2026 season as a pack of questions, riding the season (`competitions.pack` on 'nfl'), so an NFL pool on the
-- start page opens with them ticked beside pick'em and last one standing, as the NBA's and the World Series' do. Every
-- question starts level, as every pack's do; the answers are listed in the order the market had them on 15 October 2026
-- (DraftKings' futures on ESPN, the favourite first). Coins drop on the first of each month to the Super Bowl. Safe to
-- run twice.

insert into public.pool_packs (slug, name, brand, markets, drops) values ('nfl-2026', 'NFL 2026',
  '{"tagline": "An NFL pool", "trophy": "The Lombardi", "booby": "The First Pick", "icon": "🏈",
    "blurb": "The Super Bowl, both conferences, the best record and the awards, called all season with coins every month",
    "coin": {"name": "Coins", "emoji": "🪙"}, "bot": {"name": "Coach", "emoji": "🎙️"}, "colors": {"gold": "#4ade80"}}'::jsonb,
  '[
    {"title": "Who wins the Super Bowl?", "category": "The Super Bowl", "sort": 1,
     "rule": "The winner of the 2026 season''s Super Bowl, in February 2027. Anyone else covers every team not named. Closes when the playoffs start; the host moves the time if they start on another day.",
     "outcomes": ["San Francisco 49ers", "Los Angeles Rams", "Buffalo Bills", "Baltimore Ravens", "Kansas City Chiefs", "Seattle Seahawks", "Jacksonville Jaguars", "Cincinnati Bengals", "New England Patriots", "Anyone else"],
     "closes_at": "2027-01-16T18:00:00Z"},
    {"title": "Who wins the AFC?", "category": "The Super Bowl", "sort": 2,
     "rule": "The AFC champion, the team that reaches the Super Bowl from the AFC. Anyone else covers every team not named. Closes when the playoffs start.",
     "outcomes": ["Baltimore Ravens", "Buffalo Bills", "Kansas City Chiefs", "Jacksonville Jaguars", "New England Patriots", "Cincinnati Bengals", "Denver Broncos", "Houston Texans", "Pittsburgh Steelers", "Anyone else"],
     "closes_at": "2027-01-16T18:00:00Z"},
    {"title": "Who wins the NFC?", "category": "The Super Bowl", "sort": 3,
     "rule": "The NFC champion, the team that reaches the Super Bowl from the NFC. Anyone else covers every team not named. Closes when the playoffs start.",
     "outcomes": ["San Francisco 49ers", "Los Angeles Rams", "Seattle Seahawks", "Minnesota Vikings", "Detroit Lions", "Chicago Bears", "Green Bay Packers", "Dallas Cowboys", "Philadelphia Eagles", "Anyone else"],
     "closes_at": "2027-01-16T18:00:00Z"},
    {"title": "Does the AFC win the Super Bowl?", "category": "The Super Bowl", "sort": 4,
     "rule": "Yes if the Super Bowl winner is the AFC champion.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-01-16T18:00:00Z"},
    {"title": "Who has the best record?", "category": "The season", "sort": 10,
     "rule": "The team with the best record in the 2026 regular season, ties broken the way the NFL seeds them. Anyone else covers every team not named.",
     "outcomes": ["San Francisco 49ers", "Kansas City Chiefs", "Buffalo Bills", "Minnesota Vikings", "Baltimore Ravens", "Jacksonville Jaguars", "Anyone else"],
     "closes_at": "2027-01-09T17:00:00Z"},
    {"title": "Who wins MVP?", "category": "The awards", "sort": 20,
     "rule": "The 2026 season''s Most Valuable Player, as the Associated Press names him. Anyone else covers every player not named. Closes before the last week of the regular season.",
     "outcomes": ["Josh Allen", "Brock Purdy", "Patrick Mahomes", "Trevor Lawrence", "Joe Burrow", "Lamar Jackson", "Drake Maye", "Dak Prescott", "Anyone else"],
     "closes_at": "2027-01-09T17:00:00Z"},
    {"title": "Who is Defensive Player of the Year?", "category": "The awards", "sort": 21,
     "rule": "The 2026 season''s Defensive Player of the Year, as the Associated Press names him. Anyone else covers every player not named.",
     "outcomes": ["Will Anderson Jr.", "T.J. Watt", "Dallas Turner", "Fred Warner", "Greg Rousseau", "Aidan Hutchinson", "Anyone else"],
     "closes_at": "2027-01-09T17:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-11-01T12:00:00Z", "amount": 250, "note": "November"},
    {"at": "2026-12-01T12:00:00Z", "amount": 250, "note": "December"},
    {"at": "2027-01-01T12:00:00Z", "amount": 250, "note": "January"},
    {"at": "2027-02-01T12:00:00Z", "amount": 250, "note": "The Super Bowl"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();

-- the season carries its questions
update public.competitions set pack = 'nfl-2026' where id = 'nfl' and pack is null;
