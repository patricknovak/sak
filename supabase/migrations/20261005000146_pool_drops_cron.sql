-- Coin drops for prediction pools (migration 145): every hour, a minute past, each active league pays the drops that are
-- due (a Love Is Blind pool's drop lands the minute after Netflix's 3 am ET release).
select cron.unschedule('pool-drops') where exists (select 1 from cron.job where jobname = 'pool-drops');
select cron.schedule('pool-drops', '1 * * * *', $$ select public.run_league_jobs('pool-drops') $$);
