-- Scheduled jobs for stat corrections, injuries, news and Garry (times are UTC).
select cron.schedule('nhl-corrections', '30 12 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=corrections',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 120000) $$);
select cron.schedule('nhl-injuries', '25 * * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=injuries',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 60000) $$);
select cron.schedule('nhl-news', '40 */2 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/nhl-sync?task=news',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 60000) $$);
-- Garry: morning recap ~10:00 ET, lineup nudge ~17:00 ET
select cron.schedule('garry-daily', '0 14 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=daily',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 60000) $$);
select cron.schedule('garry-nudge', '0 21 * * *', $$
  select net.http_post(url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=nudge',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
    timeout_milliseconds := 60000) $$);
