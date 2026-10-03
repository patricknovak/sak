-- The shadow league's rosters and lineups follow the original's every minute (a no-op while no shadow league exists).
select cron.schedule('shadow-sync', '* * * * *', $$ select public.shadow_sync() $$);
