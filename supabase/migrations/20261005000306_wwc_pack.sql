-- The 2027 Women's World Cup (Brazil, 24 June to 25 July 2027) as a pack of questions, so a group can open its pool
-- now and call it all the way to the tournament, as the women's landing page promises. ESPN carries no futures for it,
-- so the contenders are listed in alphabetical order, not a market's; every question starts level, as every pack's do.
-- It rides no event yet (the tournament's games come with its draw); a host who wants the games adds them then. Coins
-- drop at the new year and in the month of the tournament. Safe to run twice.

insert into public.pool_packs (slug, name, brand, markets, drops) values ('womens-world-cup-2027', 'Women''s World Cup 2027',
  '{"tagline": "A Women''s World Cup pool", "trophy": "The Trophy", "booby": "The Wooden Boot", "icon": "⚽",
    "blurb": "Who lifts it, how far the host goes and how the final ends, called from now to the final",
    "coin": {"name": "Coins", "emoji": "🪙"}, "bot": {"name": "Coach", "emoji": "🎙️"}, "colors": {"gold": "#f472b6"}}'::jsonb,
  '[
    {"title": "Who wins the 2027 Women''s World Cup?", "category": "The trophy", "sort": 1,
     "rule": "The champion of the 2027 Women''s World Cup in Brazil. Anyone else covers every team not named. Closes at the opening match; the host moves the time if it moves.",
     "outcomes": ["Brazil", "England", "France", "Germany", "Japan", "Spain", "Sweden", "United States", "Anyone else"],
     "closes_at": "2027-06-24T12:00:00Z"},
    {"title": "Does a European team win it?", "category": "The trophy", "sort": 2,
     "rule": "Yes if the 2027 champion is a member of UEFA.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-06-24T12:00:00Z"},
    {"title": "How far do the hosts go?", "category": "The hosts", "sort": 10,
     "rule": "The last stage Brazil play in at their own World Cup.",
     "outcomes": ["Out in the groups", "Round of 16", "Quarter-finals", "Semi-finals", "The final, and lose it", "Champions"],
     "closes_at": "2027-06-24T12:00:00Z"},
    {"title": "Do the United States reach the semi-finals?", "category": "The contenders", "sort": 11,
     "rule": "Yes if the United States play in a semi-final of the 2027 Women''s World Cup.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-06-24T12:00:00Z"},
    {"title": "How many goals in the final?", "category": "The final", "sort": 20,
     "rule": "Goals in the final at full time and in extra time, if it goes there; a penalty shoot-out counts for none.",
     "outcomes": ["0 or 1", "2", "3", "4 or more"], "closes_at": "2027-06-24T12:00:00Z"},
    {"title": "Does the final go to penalties?", "category": "The final", "sort": 21,
     "rule": "Yes if the 2027 final is decided by a penalty shoot-out.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-06-24T12:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2027-01-01T12:00:00Z", "amount": 250, "note": "The new year"},
    {"at": "2027-06-01T12:00:00Z", "amount": 250, "note": "The month of the World Cup"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();
