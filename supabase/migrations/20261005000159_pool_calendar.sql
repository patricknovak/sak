-- The calendar of pools (docs/POOLS.md section 8, P5), first step: packs for what is on now, and a start page that
-- reads like a calendar.
--
-- * Two packs: the 2026 World Series, from the eight clubs left in the division series (5 October 2026: the League
--   Championship Series start on 11 and 12 October, the World Series on 23 October), and the NHL's 2026-27 season (the
--   Cup, the Presidents' Trophy, the scoring races), which started on 29 September. Both are settled by the host.
-- * pool_pack_list() lists only packs with a question still to call, soonest deadline first, and says how many
--   questions are still open and when the next one closes; a pack whose last question has closed drops off.
-- * A pack loaded into a new pool skips the questions that have already closed (a World Series pool started after the
--   pennants are decided starts at the World Series), so a new pool never opens with questions nobody could call.

-- a pool takes a pack's questions still open (ten minutes' grace, so nobody gets one that closes as they arrive)
create or replace function public._pool_load_pack(p_league int, p_slug text, p_by int) returns int
language plpgsql security definer set search_path = public as $$
declare pk pool_packs; x jsonb; n int := 0;
begin
  select * into pk from pool_packs where slug = p_slug;
  if pk.slug is null then raise exception 'No such pack'; end if;
  for x in select * from jsonb_array_elements(pk.markets) loop
    if (x->>'closes_at')::timestamptz <= now() + interval '10 minutes' then continue; end if;
    if not exists (select 1 from pool_markets where league_id = p_league and pack = p_slug and title = x->>'title') then
      perform _pool_insert_market(p_league, x, p_by, p_slug);
      n := n + 1;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(pk.drops) loop
    if not exists (select 1 from pool_drops where league_id = p_league and note = x->>'note' and at = (x->>'at')::timestamptz) then
      insert into pool_drops (league_id, at, amount, note) values (p_league, (x->>'at')::timestamptz, (x->>'amount')::int, x->>'note');
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_load_pack(int, text, int) from public, anon, authenticated;

-- the start page's list: packs with something still to call, the one closing soonest first
drop function if exists public.pool_pack_list();
create function public.pool_pack_list() returns table (slug text, name text, questions int, color text, icon text, blurb text,
  next_close timestamptz, last_close timestamptz)
language sql stable security definer set search_path = public as $$
  select p.slug, p.name, o.n, p.brand #>> '{colors,gold}', p.brand ->> 'icon', p.brand ->> 'blurb', o.nxt, o.lst
  from pool_packs p
  cross join lateral (select count(*)::int n, min((m->>'closes_at')::timestamptz) nxt, max((m->>'closes_at')::timestamptz) lst
                      from jsonb_array_elements(p.markets) m where (m->>'closes_at')::timestamptz > now() + interval '10 minutes') o
  where o.n > 0
  order by o.nxt, p.name
$$;
grant execute on function public.pool_pack_list() to anon, authenticated;

-- ───────────── the 2026 World Series ─────────────
insert into public.pool_packs (slug, name, brand, markets, drops) values ('world-series-2026', 'World Series 2026',
  '{"tagline": "A World Series pool", "trophy": "The Commissioner''s Trophy", "booby": "The Golden Sombrero", "icon": "⚾",
    "blurb": "The pennants and the World Series, called from the division series to the last out",
    "coin": {"name": "Coins", "emoji": "🪙"}, "bot": {"name": "Skipper", "emoji": "🎙️"}, "colors": {"gold": "#60a5fa"}}'::jsonb,
  '[
    {"title": "Who wins the World Series?", "category": "The World Series", "sort": 1,
     "rule": "The winner of the 2026 World Series. Closes at the first pitch of Game 1; the host moves the time if the schedule moves.",
     "outcomes": ["Los Angeles Dodgers", "Milwaukee Brewers", "San Diego Padres", "Atlanta Braves", "New York Yankees", "Tampa Bay Rays", "Cleveland Guardians", "Chicago White Sox"],
     "closes_at": "2026-10-23T22:00:00Z"},
    {"title": "Do the Dodgers win a third straight World Series?", "category": "The World Series", "sort": 2,
     "rule": "Yes if the Los Angeles Dodgers, champions in 2024 and 2025, win the 2026 World Series.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-23T22:00:00Z"},
    {"title": "How many games does the World Series go?", "category": "The World Series", "sort": 3,
     "rule": "The number of games played in the 2026 World Series.",
     "outcomes": ["Four", "Five", "Six", "Seven"], "closes_at": "2026-10-23T22:00:00Z"},
    {"title": "Which league wins the World Series?", "category": "The World Series", "sort": 4,
     "rule": "The league of the club that wins the 2026 World Series.",
     "outcomes": ["American League", "National League"], "closes_at": "2026-10-23T22:00:00Z"},
    {"title": "Is the World Series MVP a pitcher?", "category": "The World Series", "sort": 5,
     "rule": "Yes if the World Series Most Valuable Player pitched in the series and played no other position in it. Shohei Ohtani counts as a position player.",
     "outcomes": ["Yes, a pitcher", "No, a position player"], "closes_at": "2026-10-23T22:00:00Z"},
    {"title": "Who wins the American League pennant?", "category": "The pennants", "sort": 10,
     "rule": "The winner of the 2026 American League Championship Series. Closes at the first pitch of its Game 1; the host moves the time if the schedule moves.",
     "outcomes": ["New York Yankees", "Tampa Bay Rays", "Cleveland Guardians", "Chicago White Sox"], "closes_at": "2026-10-12T16:00:00Z"},
    {"title": "Who wins the National League pennant?", "category": "The pennants", "sort": 11,
     "rule": "The winner of the 2026 National League Championship Series. Closes at the first pitch of its Game 1; the host moves the time if the schedule moves.",
     "outcomes": ["Los Angeles Dodgers", "Milwaukee Brewers", "San Diego Padres", "Atlanta Braves"], "closes_at": "2026-10-11T16:00:00Z"},
    {"title": "Does either League Championship Series go seven games?", "category": "The pennants", "sort": 12,
     "rule": "Yes if the American League or the National League Championship Series reaches a Game 7.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-11T16:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-10-11T12:00:00Z", "amount": 250, "note": "The League Championship Series"},
    {"at": "2026-10-23T12:00:00Z", "amount": 250, "note": "The World Series"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();

-- ───────────── the NHL's 2026-27 season ─────────────
-- contenders from the 2025-26 table and scoring (Colorado 121 points; McDavid 138 points, MacKinnon 53 goals); Carolina
-- won the 2026 Cup
insert into public.pool_packs (slug, name, brand, markets, drops) values ('nhl-2026-27', 'NHL 2026-27',
  '{"tagline": "An NHL pool", "trophy": "The Cup", "booby": "The Basement", "icon": "🏒",
    "blurb": "The Cup, the Presidents'' Trophy and the scoring races, called all season with coins every month",
    "coin": {"name": "Coins", "emoji": "🪙"}, "bot": {"name": "Coach", "emoji": "🎙️"}, "colors": {"gold": "#7dd3fc"}}'::jsonb,
  '[
    {"title": "Who wins the Stanley Cup?", "category": "The Cup", "sort": 1,
     "rule": "The 2027 Stanley Cup champion. Anyone else covers every club not named. Closes when the playoffs start; the host moves the time if they start on another day.",
     "outcomes": ["Colorado Avalanche", "Carolina Hurricanes", "Dallas Stars", "Vegas Golden Knights", "Tampa Bay Lightning", "Edmonton Oilers", "Florida Panthers", "Buffalo Sabres", "Montreal Canadiens", "Minnesota Wild", "Anyone else"],
     "closes_at": "2027-04-17T16:00:00Z"},
    {"title": "Does a Canadian club win the Cup?", "category": "The Cup", "sort": 2,
     "rule": "Yes if the 2027 Stanley Cup champion plays in Canada. None has won it since Montreal in 1993.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-04-17T16:00:00Z"},
    {"title": "Do the Hurricanes win it again?", "category": "The Cup", "sort": 3,
     "rule": "Yes if the Carolina Hurricanes, the 2026 champions, win the 2027 Stanley Cup.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-04-17T16:00:00Z"},
    {"title": "Who wins the Presidents'' Trophy?", "category": "The season", "sort": 10,
     "rule": "The club with the most points in the 2026-27 regular season, ties broken the way the NHL breaks them. Anyone else covers every club not named.",
     "outcomes": ["Colorado Avalanche", "Carolina Hurricanes", "Dallas Stars", "Buffalo Sabres", "Tampa Bay Lightning", "Montreal Canadiens", "Minnesota Wild", "Vegas Golden Knights", "Edmonton Oilers", "Anyone else"],
     "closes_at": "2027-04-10T16:00:00Z"},
    {"title": "How many Canadian clubs make the playoffs?", "category": "The season", "sort": 11,
     "rule": "Of the seven clubs in Canada, how many reach the 2027 playoffs.",
     "outcomes": ["Two or fewer", "Three", "Four", "Five or more"], "closes_at": "2027-04-10T16:00:00Z"},
    {"title": "Who wins the Art Ross?", "category": "The scoring races", "sort": 20,
     "rule": "The 2026-27 regular season''s points leader, as the NHL awards it. Anyone else covers every player not named.",
     "outcomes": ["Connor McDavid", "Nathan MacKinnon", "Nikita Kucherov", "Macklin Celebrini", "Leon Draisaitl", "David Pastrnak", "Martin Necas", "Anyone else"],
     "closes_at": "2027-04-10T16:00:00Z"},
    {"title": "Who wins the Rocket Richard?", "category": "The scoring races", "sort": 21,
     "rule": "The 2026-27 regular season''s goals leader, as the NHL awards it (shared if they finish level). Shared, it is voided and every stake refunded. Anyone else covers every player not named.",
     "outcomes": ["Nathan MacKinnon", "Cole Caufield", "Connor McDavid", "Kirill Kaprizov", "Macklin Celebrini", "Jason Robertson", "Wyatt Johnston", "Leon Draisaitl", "Auston Matthews", "Anyone else"],
     "closes_at": "2027-04-10T16:00:00Z"},
    {"title": "How many points does the Art Ross winner finish with?", "category": "The scoring races", "sort": 22,
     "rule": "The points total of the 2026-27 regular season''s points leader.",
     "outcomes": ["119 or fewer", "120 to 129", "130 to 139", "140 or more"], "closes_at": "2027-04-10T16:00:00Z"},
    {"title": "Does anyone score 60 goals?", "category": "The scoring races", "sort": 23,
     "rule": "Yes if any player scores 60 or more goals in the 2026-27 regular season.",
     "outcomes": ["Yes", "No"], "closes_at": "2027-04-10T16:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-11-01T12:00:00Z", "amount": 250, "note": "November"},
    {"at": "2026-12-01T12:00:00Z", "amount": 250, "note": "December"},
    {"at": "2027-01-01T12:00:00Z", "amount": 250, "note": "January"},
    {"at": "2027-02-01T12:00:00Z", "amount": 250, "note": "February"},
    {"at": "2027-03-01T12:00:00Z", "amount": 250, "note": "The deadline"},
    {"at": "2027-04-01T12:00:00Z", "amount": 250, "note": "The stretch"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();
