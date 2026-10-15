-- The NBA's 2026-27 season as a pack of questions, riding the season itself (`competitions.pack`), so an NBA pool on the
-- start page opens with them ticked beside pick'em, the streak and win totals, as the World Series pool does. Every
-- question starts level, as every pack's do; the answers are listed in the order the market had them before opening
-- night (DraftKings' futures on ESPN, 15 October 2026, the favourite first; ESPN's BPI projection for the best record).
-- Coins drop on the first of each month, as the NHL pack's do. Safe to run twice.

insert into public.pool_packs (slug, name, brand, markets, drops) values ('nba-2026-27', 'NBA 2026-27',
  '{"tagline": "An NBA pool", "trophy": "The Ring", "booby": "The Lottery", "icon": "🏀",
    "blurb": "The title, the conferences, the Cup and the awards, called all season with coins every month",
    "coin": {"name": "Coins", "emoji": "🪙"}, "bot": {"name": "Coach", "emoji": "🎙️"}, "colors": {"gold": "#fb923c"}}'::jsonb,
  '[
    {"title": "Who wins the NBA title?", "category": "The title", "sort": 1,
     "rule": "The 2027 NBA champion. Anyone else covers every team not named. Closes when the playoffs start; the host moves the time if they start on another day.",
     "outcomes": ["Oklahoma City Thunder", "San Antonio Spurs", "Philadelphia 76ers", "New York Knicks", "Boston Celtics", "Cleveland Cavaliers", "Toronto Raptors", "Minnesota Timberwolves", "Detroit Pistons", "Denver Nuggets", "Anyone else"],
     "closes_at": "2027-04-18T16:00:00Z"},
    {"title": "Who wins the East?", "category": "The title", "sort": 2,
     "rule": "The 2027 Eastern Conference champion, the team that reaches the Finals from the East. Anyone else covers every team not named. Closes when the playoffs start.",
     "outcomes": ["New York Knicks", "Philadelphia 76ers", "Boston Celtics", "Detroit Pistons", "Cleveland Cavaliers", "Miami Heat", "Toronto Raptors", "Indiana Pacers", "Atlanta Hawks", "Orlando Magic", "Anyone else"],
     "closes_at": "2027-04-18T16:00:00Z"},
    {"title": "Who wins the West?", "category": "The title", "sort": 3,
     "rule": "The 2027 Western Conference champion, the team that reaches the Finals from the West. Anyone else covers every team not named. Closes when the playoffs start.",
     "outcomes": ["Oklahoma City Thunder", "San Antonio Spurs", "Denver Nuggets", "Minnesota Timberwolves", "Los Angeles Lakers", "Houston Rockets", "Golden State Warriors", "Portland Trail Blazers", "Anyone else"],
     "closes_at": "2027-04-18T16:00:00Z"},
    {"title": "Who wins the NBA Cup?", "category": "The Cup", "sort": 5,
     "rule": "The winner of the 2026 NBA Cup, the in-season tournament. Anyone else covers every team not named. Closes on 1 December, before the knockout rounds.",
     "outcomes": ["Oklahoma City Thunder", "San Antonio Spurs", "Boston Celtics", "Philadelphia 76ers", "Detroit Pistons", "New York Knicks", "Denver Nuggets", "Toronto Raptors", "Minnesota Timberwolves", "Anyone else"],
     "closes_at": "2026-12-01T17:00:00Z"},
    {"title": "Who has the best record?", "category": "The season", "sort": 10,
     "rule": "The team with the most wins in the 2026-27 regular season, ties broken the way the NBA breaks them. Anyone else covers every team not named.",
     "outcomes": ["Oklahoma City Thunder", "San Antonio Spurs", "New York Knicks", "Boston Celtics", "Detroit Pistons", "Denver Nuggets", "Anyone else"],
     "closes_at": "2027-04-11T16:00:00Z"},
    {"title": "How many games does the best team win?", "category": "The season", "sort": 11,
     "rule": "The regular-season wins of the team with the best record in 2026-27.",
     "outcomes": ["59 or fewer", "60 to 63", "64 to 67", "68 or more"], "closes_at": "2027-04-11T16:00:00Z"},
    {"title": "Who wins MVP?", "category": "The awards", "sort": 20,
     "rule": "The 2026-27 regular season''s Most Valuable Player, as the NBA announces it. Anyone else covers every player not named. Closes before the last day of the regular season.",
     "outcomes": ["Victor Wembanyama", "Shai Gilgeous-Alexander", "Nikola Jokic", "Luka Doncic", "Giannis Antetokounmpo", "Anthony Edwards", "Jayson Tatum", "Cade Cunningham", "Anyone else"],
     "closes_at": "2027-04-11T16:00:00Z"},
    {"title": "Who is Rookie of the Year?", "category": "The awards", "sort": 21,
     "rule": "The 2026-27 Rookie of the Year, as the NBA announces it. Anyone else covers every player not named.",
     "outcomes": ["Cameron Boozer", "Darryn Peterson", "Caleb Wilson", "AJ Dybantsa", "Darius Acuff Jr.", "Yaxel Lendeborg", "Anyone else"],
     "closes_at": "2027-04-11T16:00:00Z"},
    {"title": "Who is Defensive Player of the Year?", "category": "The awards", "sort": 22,
     "rule": "The 2026-27 Defensive Player of the Year, as the NBA announces it. Anyone else covers every player not named.",
     "outcomes": ["Victor Wembanyama", "Chet Holmgren", "Ausar Thompson", "Rudy Gobert", "Anyone else"],
     "closes_at": "2027-04-11T16:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-11-01T12:00:00Z", "amount": 250, "note": "November"},
    {"at": "2026-12-01T12:00:00Z", "amount": 250, "note": "December"},
    {"at": "2027-01-01T12:00:00Z", "amount": 250, "note": "January"},
    {"at": "2027-02-01T12:00:00Z", "amount": 250, "note": "February"},
    {"at": "2027-03-01T12:00:00Z", "amount": 250, "note": "March"},
    {"at": "2027-04-01T12:00:00Z", "amount": 250, "note": "The stretch"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();

-- the season carries its questions: an NBA pool on the start page opens with them
update public.competitions set pack = 'nba-2026-27' where id = 'nba-2026-27' and pack is distinct from 'nba-2026-27';
