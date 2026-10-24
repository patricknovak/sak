-- The projections every morning (24 October 2026, Patrick: the expected points looked static). The model now counts
-- this season's games (supabase/functions/_shared/projections.ts), so it runs daily at 6:40 am Eastern, after the night's
-- last game, instead of Monday mornings only. Safe to run twice.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'projections') then perform cron.unschedule('projections'); end if;
end $$;
select cron.schedule('projections', '40 10 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=projections',
    headers := public._edge_headers(true), timeout_milliseconds := 120000) $$);
