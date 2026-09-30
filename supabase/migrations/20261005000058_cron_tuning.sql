-- Scheduler tuning: the score sync runs only when a game needs it, the hourly injury pull stays out of the
-- hours the game-day status task already covers, and the cron run history is pruned weekly.
select cron.alter_job((select jobid from cron.job where jobname = 'nhl-scores'), command := $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=scores',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 55000) where public._scores_due() $$);

-- game-day status (every 15 min, 14:00–04:59 UTC) refreshes injuries itself; the hourly pull covers the rest
select cron.alter_job((select jobid from cron.job where jobname = 'nhl-injuries'), schedule := '25 5-13 * * *');

select cron.unschedule(jobname) from cron.job where jobname = 'cron-history';
select cron.schedule('cron-history', '15 8 * * 0', $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
