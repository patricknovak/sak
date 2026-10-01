-- requested markets settle with the season edition of the Book, early afternoon ET, once the box scores and
-- the standings for the night before are in
select cron.unschedule(jobid) from cron.job where jobname = 'settle-book-season';
select cron.schedule('settle-book-season', '15 14 * * *', $$ select public.settle_season_markets(); select public.settle_race_markets() $$);
