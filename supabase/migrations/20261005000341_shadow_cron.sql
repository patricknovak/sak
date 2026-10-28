-- The shadow league is archived (migration 340): its every-minute roster mirror stops. Safe to run twice.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'shadow-sync') then perform cron.unschedule('shadow-sync'); end if;
end $$;
