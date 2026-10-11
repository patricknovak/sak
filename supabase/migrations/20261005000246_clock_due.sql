-- One live clock (11 October 2026). The scoreboard read the games table, written once a minute, while NHL centre read the
-- NHL's feed through nhl-hub every 30 seconds, so the two showed different scores and clocks on the same night. The
-- games table becomes the one source every page reads, kept within seconds of the NHL: nhl-sync's clock task (scores,
-- periods and clocks only, written where they moved) runs every 20 seconds while a game is on (migration 247), and the
-- minute's score sync keeps the box scores.
--
-- _clock_due(): a game from last night or tonight has dropped the puck (or is about to) and isn't over. Outside those
-- windows the clock job does nothing, so an off night costs nothing.
create or replace function public._clock_due() returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from games where date between today_et() - 1 and today_et()
                   and state not in ('OFF', 'FINAL', 'PPD', 'CNCL') and start_utc <= now() + interval '2 minutes')
$$;
revoke execute on function public._clock_due() from public, anon, authenticated;
