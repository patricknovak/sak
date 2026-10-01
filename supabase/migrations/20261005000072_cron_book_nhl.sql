-- the house's NHL board opens with the season Book every morning (a no-op once it's open for the season)
select cron.unschedule(jobid) from cron.job where jobname = 'open-book-season';
select cron.schedule('open-book-season', '40 13 * * *', $$ select public.open_season_markets(); select public.open_nhl_markets(); select public.reprice_season_markets() $$);
