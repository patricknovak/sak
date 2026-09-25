-- Health check every 30 minutes; Garry's weekly column Monday mornings (~10:30 ET).
select cron.schedule('health-check', '*/30 * * * *', $$ select public.health_check() $$);
select cron.schedule('garry-weekly', '30 14 * * 1', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=weekly',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 60000) $$);
