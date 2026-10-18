-- The fixtures twice a day (18 October 2026, NBA opening-week audit). The live pull fetches a game only from five minutes
-- before its stored start, and the fixtures came in once a day at 05:17 UTC, so a tip or kick-off moved earlier on the
-- day (a national TV slot, a weather move) kept picks open until the old time. A second pull at 16:17 UTC (12:17 pm
-- Eastern) catches the day's moves before the NFL's afternoon games and every evening tip. Every competition reads
-- ESPN's free feed, so it costs no requests. Safe to run twice.
select cron.unschedule('soccer-fixtures') where exists (select 1 from cron.job where jobname = 'soccer-fixtures');
select cron.schedule('soccer-fixtures', '17 5,16 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/soccer-sync?task=fixtures',
    headers := public._edge_headers(true), timeout_milliseconds := 120000) $$);
