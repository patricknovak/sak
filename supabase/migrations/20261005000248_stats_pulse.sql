-- One live clock, the points half (11 October 2026). Every page that showed tonight's fantasy points read league_games on
-- its own timer (home, my team, the scoreboard, the box score, NHL centre, the lineup views: six loops of a minute each),
-- so they agreed only by luck and each phone read the night several times a minute. stats_gen (migration 244) already
-- counts every write to the box scores; the site now hears it through realtime and reads the night once per change, in
-- one place (the store's dayPoints), for every page at once. Nothing is read while nothing moves.
--
-- The counter holds no league data (a number and a time), so any signed-in member may read it; realtime needs that to
-- deliver its changes.
grant select on public.stats_gen to authenticated;
do $$ begin
  create policy stats_gen_read on public.stats_gen for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.stats_gen; exception when duplicate_object then null; end $$;
