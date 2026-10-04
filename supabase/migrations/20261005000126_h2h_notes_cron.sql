-- Head-to-head week alerts (migration 125) every morning at 9 am Eastern (13:00 UTC), for each active league; a league
-- that plays the season total does nothing. Re-running is safe: cron.schedule replaces a job of the same name.
select cron.schedule('h2h-notes', '0 13 * * *', $$ select public.run_league_jobs('h2h-notes') $$);
