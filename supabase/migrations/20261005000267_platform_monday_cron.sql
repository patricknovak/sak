-- The Monday read (migration 266): Monday 12:55 UTC, before nine in the morning Eastern all year.
select cron.unschedule('platform-monday') where exists (select 1 from cron.job where jobname = 'platform-monday');
select cron.schedule('platform-monday', '55 12 * * 1', $$select public._platform_monday()$$);
