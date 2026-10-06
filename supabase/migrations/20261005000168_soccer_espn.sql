-- Free soccer data while we test (Patrick, 6 October 2026: "get all data feeds for personal use currently as we are
-- just testing them and will replace them with paid data once we stop testing"). API-Football needs a paid key that was
-- never set, so no soccer competition had a single match. ESPN's public scoreboard is free and keyless: each competition
-- now names it as its provider, with the league's ESPN slug as its id, and soccer-sync reads it (the clubs, the season a
-- month at a time, today's scores while a match is on). Rounds are cut from the schedule (ESPN has no matchweek), once,
-- so they never move under a pool. Only a competition with no matches yet moves, so a pool already on API-Football's
-- data is never cut off; putting a competition back on a licensed feed is the same update the other way, before its
-- pools open.
update public.competitions c set provider = 'espn', ext_id = v.slug
from (values ('epl', 'eng.1'), ('mls', 'usa.1'), ('ligamx', 'mex.1'), ('nwsl', 'usa.nwsl'), ('ucl', 'uefa.champions'), ('wsl', 'eng.w.1')) v(id, slug)
where c.id = v.id and c.provider = 'api-football'
  and not exists (select 1 from public.fixtures f where f.competition = c.id);
