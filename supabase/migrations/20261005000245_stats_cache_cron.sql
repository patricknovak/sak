-- The kept season and windows (migration 244) rebuilt every minute when out of date: the backstop to nhl-sync's call after
-- each scores run, and the first build of a new day (the windows end today). A no-op while they're current.
select cron.schedule('stats-cache', '* * * * *', $$select public.refresh_stats_cache()$$);
