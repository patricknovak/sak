-- League memory (docs/DEVELOPMENT.md, section 4): a league's past lives in the database, not in the site's code.
-- SaK's history was written into src/data/history.ts (seasons, final standings, the all-time table, trophies, the
-- timeline and the rules text); a second league had nowhere to put its own, and Garry, the history pages and the
-- tools couldn't read anyone's. These tables hold it per league, and SaK's history is loaded into them below,
-- generated from history.ts (scripts/gen-history-sql.mjs), so the database holds exactly what the site shows today.
-- The site keeps reading history.ts until it switches over in its own change; imports (Yahoo, Fantrax, ESPN) will
-- write here too.

set client_min_messages = warning;

create table if not exists public.league_seasons (
  league_id int not null default public.current_league_id() references public.leagues (id),
  season text not null,
  note text,
  penalty numeric,                  -- what last place paid (the Peter Punishment in SaK)
  sort int not null default 0,      -- newest first
  primary key (league_id, season)
);

create table if not exists public.season_results (
  league_id int not null default public.current_league_id() references public.leagues (id),
  season text not null,
  place int not null,
  team_name text not null,          -- the name that season
  gm_name text not null,
  team_id int,                      -- the franchise today, when it still plays
  points numeric,
  prize numeric,
  last_place boolean not null default false,
  note text,
  primary key (league_id, season, place)
);

-- an official all-time table up to some season (SaK's spreadsheet runs to 2024-25); later seasons add on top
create table if not exists public.league_all_time_base (
  league_id int not null default public.current_league_id() references public.leagues (id),
  franchise text not null,
  team_id int,
  points numeric not null,
  through_season text not null,
  primary key (league_id, franchise)
);

create table if not exists public.league_trophies (
  league_id int not null default public.current_league_id() references public.leagues (id),
  name text not null,
  since text,
  emoji text,
  description text,
  sort int not null default 0,
  primary key (league_id, name)
);

create table if not exists public.league_timeline (
  league_id int not null default public.current_league_id() references public.leagues (id),
  sort int not null,
  when_label text not null,
  what text not null,
  primary key (league_id, sort)
);

create table if not exists public.league_rule_text (
  league_id int not null default public.current_league_id() references public.leagues (id),
  title text not null,
  items text[] not null default '{}',
  sort int not null default 0,
  primary key (league_id, title)
);

-- each league reads its own past; nothing writes from the API yet (imports and the commissioner's tools will, through
-- functions)
do $$
declare t text;
begin
  foreach t in array array['league_seasons', 'season_results', 'league_all_time_base', 'league_trophies', 'league_timeline', 'league_rule_text'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass and polname = 'read_league') then
      execute format('create policy read_league on public.%I for select to authenticated using (league_id = (select current_league_id()))', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated, service_role', t);
  end loop;
  -- the two that name a team take their league from it
  foreach t in array array['season_results', 'league_all_time_base'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_stamp_league') then
      execute format('create trigger %I before insert on public.%I for each row execute function public._stamp_league()', t || '_stamp_league', t);
    end if;
  end loop;
end $$;

-- the all-time table: the official base plus every season after it
create or replace view public.league_all_time with (security_invoker = true) as
  with base as (select * from league_all_time_base),
  later as (
    select r.league_id, r.team_id, sum(r.points) as points
    from season_results r join league_seasons s on s.league_id = r.league_id and s.season = r.season
    where r.team_id is not null
      and s.season > (select max(b.through_season) from base b where b.league_id = r.league_id)
    group by r.league_id, r.team_id)
  select b.league_id, b.franchise, b.team_id, b.points + coalesce(l.points, 0) as points, false as credit
  from base b left join later l on l.league_id = b.league_id and l.team_id = b.team_id
  where b.team_id is not null
  union all
  -- a franchise that joined after the base: credited the base's average for the seasons before it, as SaK's
  -- spreadsheet does for expansion teams
  select l.league_id, t.name, l.team_id, (select avg(points) from base b where b.league_id = l.league_id) + l.points, true
  from later l join teams t on t.id = l.team_id
  where not exists (select 1 from base b where b.league_id = l.league_id and b.team_id = l.team_id);
revoke all on public.league_all_time from anon;
grant select on public.league_all_time to authenticated, service_role;

-- SaK (league 1) history, generated from src/data/history.ts by scripts/gen-history-sql.mjs. Safe to run twice.
insert into public.league_seasons (league_id, season, note, penalty, sort) values
  (1, '2025-26', 'Rookie GM Darin wins it all in his first season.', 270.7, 13),
  (1, '2024-25', null, null, 12),
  (1, '2023-24', null, 4.1, 11),
  (1, '2022-23', null, 60.4, 10),
  (1, '2021-22', 'First season of the "top scorer can’t be kept" rule. Patrick added a $500 bonus to the winner’s pot.', 39.6, 9),
  (1, '2020-21', 'COVID-shortened season.', 50.8, 8),
  (1, '2019-20', 'COVID year: season cut short.', 90.2, 7),
  (1, '2018-19', null, null, 6),
  (1, '2017-18', null, 35.2, 5),
  (1, '2016-17', null, 12.2, 4),
  (1, '2015-16', null, 66.9, 3),
  (1, '2014-15', null, null, 2),
  (1, '2013-14', 'Inaugural season.', null, 1)
on conflict (league_id, season) do nothing;
insert into public.season_results (league_id, season, place, team_name, gm_name, team_id, points, prize, last_place, note) values
  (1, '2025-26', 1, 'Hatrick Swayze', 'Darin', 8, 2774.75, 840, false, null),
  (1, '2025-26', 2, 'Ravens', 'Craig', 4, 2768.3, 420, false, null),
  (1, '2025-26', 3, 'Connor McPanos', 'Panagiotis', 6, 2690.6, 140, false, null),
  (1, '2025-26', 4, 'Hughes Your Daddy', 'Todd', 7, 2570.2, null, false, null),
  (1, '2025-26', 5, 'The Hip Czechs', 'Patrick', 1, 2361.45, null, false, null),
  (1, '2025-26', 6, 'Jays', 'Jason', 3, 2355.9, null, false, null),
  (1, '2025-26', 7, '#What No Way', 'Terry', 2, 2312.3, null, false, null),
  (1, '2025-26', 8, 'Eagle Palace', 'Trystan', 5, 2041.6, null, true, null),
  (1, '2024-25', 1, 'Connor McPanos', 'Panagiotis', 6, 2133.1, 816, false, null),
  (1, '2024-25', 2, 'Jays', 'Jason', 3, 2113.6, 408, false, null),
  (1, '2024-25', 3, 'The Hip Czechs', 'Patrick', 1, 2108.1, 136, false, null),
  (1, '2024-25', 4, 'North Island Ravens', 'Craig', 4, 2035.4, null, false, null),
  (1, '2024-25', 5, 'Rust-in-Peace', 'Todd', 7, 1984.6, null, false, null),
  (1, '2024-25', 6, 'Plaidsters', 'Dan', 5, 1821, null, false, null),
  (1, '2024-25', 7, '#What No Way', 'Terry', 2, 1693.8, null, false, null),
  (1, '2024-25', 8, 'The Black Sheep', 'Sean', null, 1065.4, null, true, null),
  (1, '2023-24', 1, '#What No Way', 'Terry', 2, 2245.3, 720, false, null),
  (1, '2023-24', 2, 'The Black Sheep', 'Sean', null, 2166.7, 360, false, null),
  (1, '2023-24', 3, 'Jays', 'Jason', 3, 2164.8, 120, false, null),
  (1, '2023-24', 4, 'Smokin Ze-gras', 'Todd', 7, 2096.5, null, false, null),
  (1, '2023-24', 5, 'Plaidsters', 'Dan', 5, 2040.9, null, false, null),
  (1, '2023-24', 6, 'Mid Island Ravens', 'Craig', 4, 2026.1, null, false, null),
  (1, '2023-24', 7, 'The Hip Czechs', 'Patrick', 1, 1920.6, null, false, null),
  (1, '2023-24', 8, 'Yo Mama’s Aho', 'Panagiotis', 6, 1916.5, null, true, null),
  (1, '2022-23', 1, '#What No Way', 'Terry', 2, 2124.2, 720, false, null),
  (1, '2022-23', 2, 'The Hip Czechs', 'Patrick', 1, 2059.4, 360, false, null),
  (1, '2022-23', 3, 'Mid Island Ravens', 'Craig', 4, 2003.2, 120, false, null),
  (1, '2022-23', 4, 'Jays', 'Jason', 3, 1976.9, null, false, null),
  (1, '2022-23', 5, 'Smokin Ze-gras', 'Todd', 7, 1915.6, null, false, null),
  (1, '2022-23', 6, 'Ontario Flames', 'Dan', 5, 1893.4, null, false, null),
  (1, '2022-23', 7, 'Yo Mama’s Aho', 'Panagiotis', 6, 1828.5, null, false, null),
  (1, '2022-23', 8, 'The Black Sheep', 'Sean', null, 1768.1, null, true, null),
  (1, '2021-22', 1, 'Jays', 'Jason', 3, 2153.7, 1220, false, null),
  (1, '2021-22', 2, 'The Black Sheep', 'Sean', null, 2128.8, 360, false, null),
  (1, '2021-22', 3, 'Smokin Ze-gras', 'Todd', 7, 2081.5, 120, false, null),
  (1, '2021-22', 4, 'The Hip Czechs', 'Patrick', 1, 2074.4, null, false, null),
  (1, '2021-22', 5, 'Mid Island Ravens', 'Craig', 4, 1982.3, null, false, null),
  (1, '2021-22', 6, 'Pano’s Bros Before Ahos!', 'Panagiotis', 6, 1935.5, null, false, null),
  (1, '2021-22', 7, 'Basement Dwellers', 'Terry', 2, 1922.5, null, false, null),
  (1, '2021-22', 8, 'Ontario Flames', 'Dan', 5, 1882.9, null, true, null),
  (1, '2020-21', 1, 'Jays', 'Jason', 3, 1359.8, 691.2, false, null),
  (1, '2020-21', 2, 'Mid Island Ravens', 'Craig', 4, 1324.4, 345.6, false, null),
  (1, '2020-21', 3, 'THE NUGE', 'Todd', 7, 1320.3, 115.2, false, null),
  (1, '2020-21', 4, 'Pano’s Hughes Boys!', 'Panagiotis', 6, 1301.5, null, false, null),
  (1, '2020-21', 5, 'The Black Sheep', 'Sean', null, 1281.8, null, false, null),
  (1, '2020-21', 6, 'JAGR HAS REGRETZKYS', 'Terry', 2, 1189.1, null, false, null),
  (1, '2020-21', 7, 'The Hip Czechs', 'Patrick', 1, 1186.5, null, false, null),
  (1, '2020-21', 8, 'Ontario Flames', 'Dan', 5, 1135.7, null, true, null),
  (1, '2019-20', 1, 'The Hip Czechs', 'Patrick', 1, 1729.6, 624, false, null),
  (1, '2019-20', 2, 'The Black Sheep', 'Sean', null, 1580.9, 312, false, null),
  (1, '2019-20', 3, 'Jays', 'Jason', 3, 1577.3, 104, false, null),
  (1, '2019-20', 4, 'THE NUGE', 'Todd', 7, 1553.3, null, false, null),
  (1, '2019-20', 5, 'Ontario Flames', 'Dan', 5, 1534.4, null, false, null),
  (1, '2019-20', 6, 'Pano’s Hughes Boys!', 'Panagiotis', 6, 1531.7, null, false, null),
  (1, '2019-20', 7, 'Mid Island Ravens', 'Craig', 4, 1421.4, null, false, null),
  (1, '2019-20', 8, 'NO REGRETZKYS', 'Terry', 2, 1331.2, null, true, null),
  (1, '2018-19', 1, 'Jays', 'Jason', 3, 1960.8, 648, false, null),
  (1, '2018-19', 2, 'The Black Sheep', 'Sean', null, 1926, 324, false, null),
  (1, '2018-19', 3, 'THE NUGE', 'Todd', 7, 1900.4, 108, false, null),
  (1, '2018-19', 4, 'The Hip Czechs', 'Patrick', 1, 1757.1, null, false, null),
  (1, '2018-19', 5, 'Mr Pano’s Webbers', 'Panagiotis', 6, 1756.7, null, false, null),
  (1, '2018-19', 6, 'Mid Island Ravens', 'Craig', 4, 1753.7, null, false, null),
  (1, '2018-19', 7, 'Ontario Flames', 'Dan', 5, 1742.5, null, false, null),
  (1, '2018-19', 8, 'No Regretzkys', 'Terry', 2, 1698.3, null, false, null),
  (1, '2018-19', 9, 'The FMB Broncos', 'Jason G', null, 1518.3, null, true, null),
  (1, '2017-18', 1, 'THE NUGE', 'Todd', 7, 1937.2, 600.6, false, null),
  (1, '2017-18', 2, 'The Black Sheep', 'Sean', null, 1910.9, 300.3, false, null),
  (1, '2017-18', 3, 'The Hip Czechs', 'Patrick', 1, 1900.4, 100.1, false, null),
  (1, '2017-18', 4, 'Mr Pano’s NorthStars', 'Panagiotis', 6, 1881.2, null, false, null),
  (1, '2017-18', 5, 'Jays', 'Jason', 3, 1816.2, null, false, null),
  (1, '2017-18', 6, 'Ontario Flames', 'Dan', 5, 1728.8, null, false, null),
  (1, '2017-18', 7, 'THE JOEY MOSS’s', 'Terry', 2, 1717.1, null, false, null),
  (1, '2017-18', 8, 'Mid Island Ravens', 'Craig', 4, 1676.9, null, false, null),
  (1, '2017-18', 9, 'The Webers', 'Jason G', null, 1641.7, null, true, null),
  (1, '2016-17', 1, 'The Black Sheep', 'Sean', null, 1770.5, 540.6, false, null),
  (1, '2016-17', 2, 'Jays', 'Jason', 3, 1757.1, 270.3, false, null),
  (1, '2016-17', 3, 'THE NUGE', 'Todd', 7, 1737.6, 90.1, false, null),
  (1, '2016-17', 4, 'Rowdy Ravens', 'Craig', 4, 1675, null, false, null),
  (1, '2016-17', 5, 'Pano’s North Stars', 'Panagiotis', 6, 1634, null, false, null),
  (1, '2016-17', 6, 'The Hip Czechs', 'Patrick', 1, 1614.2, null, false, null),
  (1, '2016-17', 7, 'THE JOEY MOSS’s', 'Terry', 2, 1607.9, null, false, null),
  (1, '2016-17', 8, 'Ontario Flames', 'Dan', 5, 1569.7, null, false, null),
  (1, '2016-17', 9, 'The Webers', 'Jason G', null, 1557.5, null, true, null),
  (1, '2015-16', 1, 'The Black Sheep', 'Sean', null, 1942.5, 500, false, null),
  (1, '2015-16', 2, 'Jays', 'Jason', 3, 1903.4, 250, false, null),
  (1, '2015-16', 3, 'THE NUGE', 'Todd', 7, 1873.2, 75, false, null),
  (1, '2015-16', 4, 'The Rowdy Ravens', 'Craig', 4, 1845.4, null, false, null),
  (1, '2015-16', 5, 'Ontario Flames', 'Dan', 5, 1839.4, null, false, null),
  (1, '2015-16', 6, 'The Hip Czechs', 'Patrick', 1, 1838.2, null, false, null),
  (1, '2015-16', 7, 'Pano’s North Stars', 'Panagiotis', 6, 1808.6, null, false, null),
  (1, '2015-16', 8, 'THE JOEY MOSS’s', 'Terry', 2, 1741.7, null, true, null),
  (1, '2014-15', 1, 'THE NUGE', 'Todd', 7, 2418.5, 450, false, null),
  (1, '2014-15', 2, 'The Rowdy Ravens', 'Craig', 4, 2380.5, 200, false, null),
  (1, '2014-15', 3, 'Vancouver Flames', 'Dan', 5, 2366.9, 60, false, null),
  (1, '2014-15', 4, 'Jays', 'Jason', 3, 2323.7, null, false, null),
  (1, '2014-15', 5, 'Pano’s North Stars', 'Panagiotis', 6, 2257.1, null, false, null),
  (1, '2014-15', 6, 'The Hip Czechs', 'Patrick', 1, 2255.5, null, false, null),
  (1, '2014-15', 7, 'The Black Sheep', 'Sean', null, 1808.2, null, true, null),
  (1, '2013-14', 1, 'Jays', 'Jason', 3, 1938.7, 400, false, null),
  (1, '2013-14', 2, 'Vancouver Flames', 'Dan', 5, 1904.4, 175, false, null),
  (1, '2013-14', 3, 'The Hip Czechs', 'Patrick', 1, 1874.4, 50, false, null),
  (1, '2013-14', 4, 'The Rowdy Ravens', 'Craig', 4, 1811.8, null, false, null),
  (1, '2013-14', 5, 'THE NUGE', 'Todd', 7, 1762, null, false, null),
  (1, '2013-14', 6, 'The Big Pavelski', 'Panagiotis', 6, 1744.6, null, true, 'Inaugural Peter winner')
on conflict (league_id, season, place) do nothing;
insert into public.league_all_time_base (league_id, franchise, team_id, points, through_season) values
  (1, 'Jays', 3, 23046, '2024-25'),
  (1, 'THE NUGE', 7, 22580.7, '2024-25'),
  (1, 'The Hip Czechs', 1, 22318.4, '2024-25'),
  (1, 'Mid Island Ravens', 4, 21936.1, '2024-25'),
  (1, 'Mr. Pano’s Webbers', 6, 21729, '2024-25'),
  (1, 'Ontario Flames', 5, 21460, '2024-25'),
  (1, 'No Regretzkys', 2, 21369, '2024-25'),
  (1, 'The Black Sheep', null, 21189.1, '2024-25')
on conflict (league_id, franchise) do nothing;
insert into public.league_trophies (league_id, name, since, emoji, description, sort) values
  (1, 'The Johnson', '2013', '🏆', 'SaK’s championship hardware, awarded with the lion’s share of the prize pool.', 1),
  (1, 'The Peter', '2013', '🪣', 'Last place. Comes with the Peter Punishment: $1 per point behind second-last, paid into the SaK Fund.', 2),
  (1, 'The Korogon-Ass Trophy', '2015-16', '🤡', 'Unsportsmanlike conduct: whinging, sore losing, excuse making.', 3)
on conflict (league_id, name) do nothing;
insert into public.league_timeline (league_id, when_label, what, sort) values
  (1, 'Sep 2013', 'SaK League founded by Patrick with Jason, Todd, Craig, Panagiotis and Dan. Dues $100.', 1),
  (1, 'Sep 2013', 'The Johnson and The Peter trophies introduced.', 2),
  (1, 'Sep 2014', 'Sean joins (The Black Sheep).', 3),
  (1, 'Sep 2015', 'Terry joins. SaK Fund established.', 4),
  (1, '2015-16', 'Korogon-Ass Trophy added for unsportsmanlike conduct. Vancouver Flames move to Ontario.', 5),
  (1, 'Sep 2016', 'Jason Griffiths joins.', 6),
  (1, 'Sep 2019', 'Jason Griffiths leaves; keeper count changes by text vote.', 7),
  (1, 'Sep 2021', 'League moves to Ethereum (cancelled 2023-24). Top scorer on each team can no longer be kept.', 8),
  (1, 'Sep 2023', 'Trystan starts co-managing with Dan.', 9),
  (1, 'Sep 2025', 'Dan and Sean leave; Trystan takes over Dan’s franchise; Darin joins and wins it all.', 10),
  (1, 'Sep 2026', 'SaK moves off Yahoo to its own home: this site.', 11)
on conflict (league_id, sort) do nothing;
insert into public.league_rule_text (league_id, title, items, sort) values
  (1, 'Code of Ethics', array['All SaK rules are set up so every GM competes through to the end of the season and is actively trying to win.', 'This is a league of winners who are always looking to win; whiners, sore losers, complainers and excuse makers are not welcome or rewarded.', 'Play fair, play hard and play to win. Those are SaK GM qualities.']::text[], 1),
  (1, 'Format', array['Season-long points league: most fantasy points at the end of the NHL regular season wins the regular-season pot. From 2026-27 the season carries on through the NHL playoffs as a second, separate race for the playoff pot.', 'Rosters: C, C, LW, LW, RW, RW, D, D, D, Util, G, G plus 12 bench and 2 IR spots.', 'Daily lineups. A player locks when his NHL game starts; only starters (not BN/IR) score.', 'IR: 2 spots, for players on the injury report (not suspensions). Each player on IR frees a roster spot for a pickup or trade. He stays on IR, even once healthy, until his GM moves him off, which needs a free roster spot (drop or trade someone first). Lineup tools and auto-pilot never move players on or off IR.', 'Live standard (snake) draft with a pick clock. Draft picks can be traded.']::text[], 2),
  (1, 'Keepers', array['6 keepers in a non-expansion year, 5 in an expansion year.', 'Your top-scoring player from last season cannot be kept and goes back into the draft pool (since 2021-22).', 'Expansion GMs draft in the middle position and get first pick of everyone’s non-keepers before draft day (no rookies).']::text[], 3),
  (1, 'Transactions', array['10 free-agent pickups for the regular season and playoffs, plus 3 more when the playoffs start. No paid extra pickups: pickups are tradable, so trade with another GM for more.', 'No maximum on trades: the league wants as many trades as possible.', 'Trades are reviewed by the commissioner for fairness; generally all trades are approved. Accepted trades auto-approve after 24 hours.', 'Trade deadline matches the NHL trade deadline.']::text[], 4),
  (1, 'Money', array['Entry $200 per team, of which $25 goes to the SaK Fund; the other $175 per team is the prize pool.', 'From 2026-27 the prize pool is split 60% regular season and 40% playoffs. Each pot pays 1st / 2nd / 3rd 60 / 30 / 10.', 'The playoffs use the same rosters: only fantasy points from NHL playoff games count toward the separate playoff table.', 'The Peter Punishment: last place pays $1 per point behind second-last into the SaK Fund.', 'Get SaK’ed: $5 per game your player is suspended (max $50 per player, $100 per team per season), all to the SaK Fund.', 'The SaK Fund is shared equally and is for future GM fun (a GM trip to the draft, etc.). A GM who leaves forfeits their share; if the league disbands, remaining GMs split it.']::text[], 5),
  (1, 'Expansion', array['Expansion fee $150. No more than 2 new GMs per season, and new GMs must be known by at least 2 existing GMs.', 'Sponsor GMs pay $25 each if the new GM doesn’t meaningfully contribute (trash talk, trades, helping the league) in their first year, decided by anonymous majority vote.', 'A GM who refers a new GM who pulls out within 2 seasons pays $50 to the fund; if the new GM sticks, the referrer gets a $50 bonus.', 'Expansion GMs don’t vote on league changes in their first season.']::text[], 6),
  (1, 'Governance', array['Any GM can propose a rule change anytime. Without 100% consensus, a proposal with 2+ sponsors goes to a vote; simple majority decides; the commissioner has veto.', 'Commissioners can be replaced by election: any GM can run, and the new commissioner needs 50% + 1 of the votes.']::text[], 7)
on conflict (league_id, title) do nothing;
