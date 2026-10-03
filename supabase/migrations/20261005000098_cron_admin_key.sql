-- The heavy nhl-sync tasks send the admin key (migration 97's _edge_headers): same jobs, same times, same timeouts.
select cron.schedule('nhl-players', '15 9,13,16,19 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=players',
    headers := public._edge_headers(true), timeout_milliseconds := 120000) $$);
select cron.schedule('nhl-players-pregame', '45 21,22 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=players',
    headers := public._edge_headers(true), timeout_milliseconds := 120000) $$);
select cron.schedule('projections', '0 10 * * 1', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=projections',
    headers := public._edge_headers(true), timeout_milliseconds := 120000) $$);
select cron.schedule('nhl-corrections', '30 12 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=corrections',
    headers := public._edge_headers(true), timeout_milliseconds := 120000) $$);
select cron.schedule('nhl-corrections-deep', '20 11 * * 1', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=corrections&days=21',
    headers := public._edge_headers(true), timeout_milliseconds := 150000) $$);
