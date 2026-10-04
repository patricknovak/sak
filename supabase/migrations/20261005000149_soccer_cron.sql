-- Soccer's schedule (migration 148). The fixtures once a day; the live pull every two minutes, only while a match is on
-- or about to kick off (_soccer_due), so a quiet day costs no requests; questions settle within five minutes of a
-- final whistle (_pool_settle_due). Both soccer-sync tasks spend the provider's request allowance, so they send the
-- platform key (_edge_headers(true)) and the function refuses anyone without it.
select cron.unschedule(j) from unnest(array['soccer-fixtures', 'soccer-live', 'pool-settle']) j
where exists (select 1 from cron.job where jobname = j);
select cron.schedule('soccer-fixtures', '17 5 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/soccer-sync?task=fixtures',
    headers := public._edge_headers(true), timeout_milliseconds := 120000) $$);
select cron.schedule('soccer-live', '*/2 * * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/soccer-sync?task=live',
    headers := public._edge_headers(true), timeout_milliseconds := 55000) where public._soccer_due() $$);
select cron.schedule('pool-settle', '*/5 * * * *', $$ select public.run_league_jobs('pool-settle') where public._pool_settle_due() $$);
