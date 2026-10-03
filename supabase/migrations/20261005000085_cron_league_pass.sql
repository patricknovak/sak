-- B4: the Book and the bet settler run once per active league (run_league_jobs sets the league for each run, and a
-- failure in one league doesn't stop the others). Same jobs, same times. cron.schedule with an existing name
-- replaces that job's command.
select cron.schedule('open-book', '35 13 * * *', $$ select public.run_league_jobs('open-book') $$);
select cron.schedule('open-book-season', '40 13 * * *', $$ select public.run_league_jobs('open-book-season') $$);
select cron.schedule('settle-book', '*/30 * * * *', $$ select public.run_league_jobs('settle-book') $$);
select cron.schedule('settle-book-season', '15 14 * * *', $$ select public.run_league_jobs('settle-book-season') $$);
select cron.schedule('settle-bets', '45 12 * * *', $$ select public.run_league_jobs('settle-bets') $$);
