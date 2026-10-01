-- the season edition of the Book: open once the season is on and re-price every morning after the day's
-- markets open; settle once a day, early afternoon ET, after the standings and season stats are in
select cron.unschedule(jobid) from cron.job where jobname in ('open-book-season', 'settle-book-season');
select cron.schedule('open-book-season', '40 13 * * *', $$ select public.open_season_markets(); select public.reprice_season_markets() $$);
select cron.schedule('settle-book-season', '15 14 * * *', $$ select public.settle_season_markets() $$);
