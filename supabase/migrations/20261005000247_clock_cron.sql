-- The clock job (migration 246): nhl-sync's clock task every 20 seconds while a game is on, with the platform's admin key
-- read when it runs (migration 243). Three light calls a minute (two NHL score feeds, a read of the games and a write of
-- the ones that moved) for the four or five hours of a game night; nothing on other hours.
select cron.unschedule(jobname) from cron.job where jobname = 'nhl-clock';
select cron.schedule('nhl-clock', '20 seconds', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=clock',
    headers := public._edge_headers(true), timeout_milliseconds := 15000) where public._clock_due() $$);
