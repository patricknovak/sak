-- the trade block updates live on the Trades page
do $$ begin alter publication supabase_realtime add table public.trade_block; exception when duplicate_object then null; end $$;

-- NHL standings and playoff odds: twice a day (6:10 AM and 2:10 PM ET), so forecasts follow the races and the bracket
select cron.schedule('nhl-standings', '10 10,18 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=standings',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 60000) $$);
