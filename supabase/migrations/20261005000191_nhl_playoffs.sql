-- The Stanley Cup playoffs as series (docs/POOL-TYPES.md §9): mlb-sync, the postseason feed, reads the NHL's bracket and
-- each series' games for every active competition whose provider is 'nhl-api' (`_shared/nhlPlayoffs.ts`), so Pick the
-- series, the bracket and Rank the teams run on the NHL's playoffs as on baseball's. The NHL letters its series in
-- bracket order, so the bracket starts from the first round. Tested on the 2026 playoffs; the 2027 competition stays
-- empty until the NHL draws its bracket in April. The two-minute live cadence covers it as it covers baseball.

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort, format)
values ('nhl-post-2027', 'nhl', 'Stanley Cup Playoffs 2027', 'NHL', 'USA', 'America/New_York', '2027', 'nhl-api', 'nhl', '20262027', true, 1, 'series')
on conflict (id) do nothing;

-- a game of either postseason under way or about to start: the feed every two minutes
create or replace function public._mlb_due() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fixtures f join competitions c on c.id = f.competition
                 where c.provider in ('mlb-statsapi', 'nhl-api') and c.active
                   and ((f.state in ('scheduled', 'live') and f.kickoff between now() - interval '7 hours' and now() + interval '10 minutes')
                        or (f.state = 'final' and f.updated_at > now() - interval '1 hour' and f.kickoff > now() - interval '12 hours')))
$$;
revoke execute on function public._mlb_due() from public, anon, authenticated;
