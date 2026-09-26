-- Garry's draft-day nag (Sun Sep 27 2026, 3 PM ET = 19:00 UTC): who still has no queue / no alerts, with the taps to fix it.
-- The draft-eve post was fired by hand. The keeper-report job is dropped: keepers are final and the report is filed.
select cron.unschedule('garry-keepers') where exists (select 1 from cron.job where jobname = 'garry-keepers');
select cron.schedule('garry-draftprep', '0 19 27 9 *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=draftprep',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    body := '{}'::jsonb, timeout_milliseconds := 120000) $$);
