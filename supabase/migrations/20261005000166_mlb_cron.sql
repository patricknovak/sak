-- Baseball's postseason feed (migration 165): mlb-sync every two minutes while a game is on, about to start or just
-- over (_mlb_due), and every half hour otherwise so a new round's clubs and first-pitch times arrive. One request each.
select cron.unschedule(j) from unnest(array['mlb-live', 'mlb-schedule']) j
where exists (select 1 from cron.job where jobname = j);
select cron.schedule('mlb-live', '*/2 * * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/mlb-sync',
    headers := public._edge_headers(true), timeout_milliseconds := 55000) where public._mlb_due() $$);
select cron.schedule('mlb-schedule', '7,37 * * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/mlb-sync',
    headers := public._edge_headers(true), timeout_milliseconds := 55000) $$);
