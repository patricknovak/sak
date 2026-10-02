-- Garry's unprompted moments: every half hour he looks at the box scores, the table and the trade log and
-- calls out what's worth it (at most two a league day). Reads only; the model runs only when he posts.
select cron.unschedule(jobid) from cron.job where jobname = 'garry-moments';
select cron.schedule('garry-moments', '7,37 * * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=moments',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 60000) $$);
